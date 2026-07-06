import { Duplex } from "node:stream";
import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";
import { logError, logInfo } from "./reliability";

// ─────────────────────────────────────────────────────────────────────────────
// SSH tunnel to a self-hosted Postgres server that only accepts local
// (loopback) connections. Instead of exposing Postgres on a public port
// (5432) and relying on IP-allowlisting a Vercel serverless function's
// non-static IP, every DB connection is forwarded over SSH (port 22, already
// reachable for server management) straight to the remote host's own
// 127.0.0.1:5432. From Postgres's point of view the connection originates
// locally, so pg_hba.conf rules for local connections keep working
// unchanged — nothing on the DB server needs to be reconfigured, and the
// public internet never touches the database port at all.
//
// Activated automatically when SSH_HOST + SSH_PRIVATE_KEY are set. Falls
// back to a direct TCP connection (node-postgres' default behaviour) when
// they are absent.
// ─────────────────────────────────────────────────────────────────────────────

export function sshTunnelConfigured(): boolean {
  return Boolean(process.env.SSH_HOST && process.env.SSH_PRIVATE_KEY);
}

// A private key pasted into an env var UI often loses its real line breaks
// (stored as the literal two-character sequence "\n", or with Windows CRLF
// line endings) — either corrupts the PEM/OpenSSH structure ssh2 expects.
// Normalize both cases; a no-op for an already-correct multi-line key.
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (!key.includes("\n") && key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }
  return key.replace(/\r\n/g, "\n");
}

const g = globalThis as unknown as {
  __ctSshClient?: Client | null;
  __ctSshReady?: Promise<Client> | null;
};

// Reveals only the key's format/type (e.g. "OPENSSH PRIVATE KEY", "RSA
// PRIVATE KEY") from its PEM header — never the key material itself — so a
// parse failure can be diagnosed without logging anything sensitive.
function describeKeyFormat(key: string): string {
  const match = key.match(/-----BEGIN ([A-Z0-9 ]+)-----/);
  return match ? match[1] : "no PEM/OpenSSH header found";
}

function connectSsh(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const privateKey = normalizePrivateKey(process.env.SSH_PRIVATE_KEY!);
    client
      .on("ready", () => {
        logInfo("ssh", "SSH connection established", { host: process.env.SSH_HOST });
        resolve(client);
      })
      .on("error", (err) => {
        // Log directly here — this is the actual root cause (auth failure,
        // host unreachable, etc.) before anything wraps/loses it upstream.
        logError("ssh", "SSH connection failed", {
          host: process.env.SSH_HOST,
          user: process.env.SSH_USER || "root",
          message: err.message,
          level: (err as Error & { level?: string }).level,
          keyFormat: describeKeyFormat(privateKey),
        });
        g.__ctSshClient = null;
        g.__ctSshReady = null;
        reject(err);
      })
      .on("close", () => {
        // Drop the cached client so the next request opens a fresh session
        // instead of trying to reuse a dead SSH connection.
        if (g.__ctSshClient === client) {
          g.__ctSshClient = null;
          g.__ctSshReady = null;
        }
      });

    try {
      client.connect({
        host: process.env.SSH_HOST,
        port: Number(process.env.SSH_PORT ?? "22"),
        username: process.env.SSH_USER || "root",
        privateKey,
        passphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE || undefined,
        readyTimeout: 10_000,
        keepaliveInterval: 15_000,
      });
    } catch (err) {
      // ssh2 parses/validates the private key synchronously inside connect()
      // and throws immediately on a bad format, bypassing the 'error' event
      // entirely — catch that here so the key-format diagnostic always logs.
      logError("ssh", "SSH connect() threw synchronously", {
        host: process.env.SSH_HOST,
        message: (err as Error).message,
        keyFormat: describeKeyFormat(privateKey),
        keyLength: privateKey.length,
        keyLineCount: privateKey.split("\n").length,
      });
      reject(err);
    }
  });
}

function getSshClient(): Promise<Client> {
  if (g.__ctSshClient) return Promise.resolve(g.__ctSshClient);
  if (!g.__ctSshReady) {
    g.__ctSshReady = connectSsh().then((client) => {
      g.__ctSshClient = client;
      return client;
    });
  }
  return g.__ctSshReady;
}

// node-postgres' Connection class (lib/connection.js) treats `config.stream`
// as a socket-like object: it calls `.setNoDelay()`, then `.connect(port,
// host)` to kick off the connection, and listens for a `'connect'` event
// before proceeding with the Postgres handshake. This differs from mysql2's
// stream contract (which expects an already-connecting stream with no
// `.connect()` call) — so this proxy implements the exact interface pg
// expects, bridging to the inherently-async ssh2 `forwardOut` channel.
class SshTunnelSocket extends Duplex {
  private real: ClientChannel | null = null;
  private pending: Array<{ chunk: Buffer; cb: (err?: Error | null) => void }> = [];

  constructor(
    private readonly remoteHost: string,
    private readonly remotePort: number
  ) {
    super();
  }

  setNoDelay(): this {
    return this; // no-op: TCP_NODELAY has no equivalent on an SSH channel
  }

  connect(): void {
    getSshClient()
      .then(
        (client) =>
          new Promise<ClientChannel>((resolve, reject) => {
            client.forwardOut("127.0.0.1", 0, this.remoteHost, this.remotePort, (err, channel) => {
              if (err) reject(err);
              else resolve(channel);
            });
          })
      )
      .then((channel) => {
        this.real = channel;
        for (const { chunk, cb } of this.pending) channel.write(chunk, cb);
        this.pending.length = 0;

        channel.on("data", (d: Buffer) => {
          if (!this.push(d)) channel.pause();
        });
        this.on("drain", () => channel.resume());
        channel.on("end", () => this.push(null));
        channel.on("close", () => this.emit("close"));
        channel.on("error", (err: Error) => this.emit("error", err));

        this.emit("connect");
      })
      .catch((err) => {
        logError("ssh", "failed to open forwarded channel to remote DB", {
          remoteHost: this.remoteHost,
          remotePort: this.remotePort,
          message: (err as Error).message,
        });
        this.emit("error", err);
      });
  }

  _read(): void {
    this.real?.resume();
  }

  _write(chunk: Buffer, _enc: string, cb: (err?: Error | null) => void): void {
    if (this.real) this.real.write(chunk, cb);
    else this.pending.push({ chunk, cb });
  }

  _final(cb: (err?: Error | null) => void): void {
    this.real ? this.real.end(cb) : cb();
  }

  _destroy(err: Error | null, cb: (err: Error | null) => void): void {
    this.real?.destroy();
    cb(err);
  }
}

export function createSshTunnelStreamFactory() {
  const remoteHost = process.env.DB_TUNNEL_REMOTE_HOST || "127.0.0.1";
  const remotePort = Number(process.env.DB_TUNNEL_REMOTE_PORT ?? "5432");

  return function streamFactory(): SshTunnelSocket {
    return new SshTunnelSocket(remoteHost, remotePort);
  };
}

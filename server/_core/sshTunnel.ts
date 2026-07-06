import { Duplex } from "node:stream";
import { Client } from "ssh2";
import type { ClientChannel } from "ssh2";

// ─────────────────────────────────────────────────────────────────────────────
// SSH tunnel to a self-hosted MySQL server that only accepts local (loopback)
// connections. Instead of exposing MySQL on a public port (3306) and relying
// on IP-allowlisting a Vercel serverless function's non-static IP, every DB
// connection is forwarded over SSH (port 22, already reachable for server
// management) straight to the remote host's own 127.0.0.1:3306. From MySQL's
// point of view the connection originates locally, so the default
// bind-address (127.0.0.1) and 'localhost'-only user grants keep working
// unchanged — nothing on the MySQL server needs to be reconfigured.
//
// Activated automatically when SSH_HOST + SSH_PRIVATE_KEY are set. Falls back
// to a direct TCP connection (the previous behaviour) when they are absent.
// ─────────────────────────────────────────────────────────────────────────────

export function sshTunnelConfigured(): boolean {
  return Boolean(process.env.SSH_HOST && process.env.SSH_PRIVATE_KEY);
}

const g = globalThis as unknown as {
  __ctSshClient?: Client | null;
  __ctSshReady?: Promise<Client> | null;
};

function connectSsh(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", (err) => {
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
      })
      .connect({
        host: process.env.SSH_HOST,
        port: Number(process.env.SSH_PORT ?? "22"),
        username: process.env.SSH_USER || "root",
        privateKey: process.env.SSH_PRIVATE_KEY,
        passphrase: process.env.SSH_PRIVATE_KEY_PASSPHRASE || undefined,
        readyTimeout: 10_000,
        keepaliveInterval: 15_000,
      });
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

// mysql2 calls `config.stream(opts)` and expects a Duplex stream back
// SYNCHRONOUSLY (see mysql2/lib/base/connection.js) — it does not support a
// callback- or promise-based factory. Opening an SSH-forwarded channel is
// inherently async (it's a round trip over the SSH connection), so this
// returns a lightweight proxy Duplex immediately: writes are buffered until
// the real forwarded channel is ready, then everything is piped through it.
function createProxyStream(openRealChannel: () => Promise<ClientChannel>): Duplex {
  let real: ClientChannel | null = null;
  let destroyed = false;
  const pendingWrites: Array<{ chunk: Buffer; cb: (err?: Error | null) => void }> = [];

  const proxy = new Duplex({
    read() {
      real?.resume();
    },
    write(chunk, _enc, cb) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (real) real.write(buf, cb);
      else pendingWrites.push({ chunk: buf, cb });
    },
    final(cb) {
      real ? real.end(cb) : cb();
    },
    destroy(err, cb) {
      real?.destroy();
      cb(err);
    },
  });

  openRealChannel()
    .then((channel) => {
      if (destroyed) return channel.destroy();
      real = channel;
      for (const { chunk, cb } of pendingWrites) real.write(chunk, cb);
      pendingWrites.length = 0;

      channel.on("data", (d: Buffer) => {
        if (!proxy.push(d)) channel.pause();
      });
      proxy.on("drain", () => channel.resume());
      channel.on("end", () => proxy.push(null));
      channel.on("close", () => proxy.destroy());
      channel.on("error", (err: Error) => proxy.destroy(err));
    })
    .catch((err) => proxy.destroy(err as Error));

  proxy.on("close", () => {
    destroyed = true;
  });

  return proxy;
}

export function createSshTunnelStreamFactory() {
  const remoteHost = process.env.DB_TUNNEL_REMOTE_HOST || "127.0.0.1";
  const remotePort = Number(process.env.DB_TUNNEL_REMOTE_PORT ?? "3306");

  return function streamFactory(): Duplex {
    return createProxyStream(
      () =>
        new Promise<ClientChannel>((resolve, reject) => {
          getSshClient()
            .then((client) => {
              client.forwardOut("127.0.0.1", 0, remoteHost, remotePort, (err, stream) => {
                if (err) reject(err);
                else resolve(stream);
              });
            })
            .catch(reject);
        })
    );
  };
}

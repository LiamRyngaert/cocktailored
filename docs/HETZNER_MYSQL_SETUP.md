# Vercel ↔ Hetzner MySQL: fixing `ETIMEDOUT`

If `DATABASE_URL` points to a self-hosted MySQL server on a Hetzner Cloud VPS
and every query fails with `ETIMEDOUT: connect ETIMEDOUT`, this is a **network
connectivity issue**, not an application bug. Vercel serverless functions do
not have a static outbound IP address on the Free/Pro plan, so the connection
must be allowed from any IP and secured with a strong password + TLS instead
of IP allowlisting.

There are three independent checks — all three must pass simultaneously,
since any one of them alone is enough to cause the exact same timeout.

## 1. Hetzner Cloud Firewall (check this first — most common cause)

Automated provisioning tools commonly open only SSH (port 22) and leave
every other port closed by default (Hetzner Cloud Firewalls are
default-deny: any port with no explicit allow rule silently drops all
traffic — which is exactly what produces `ETIMEDOUT` rather than
`ECONNREFUSED`).

1. Go to **console.hetzner.cloud** → your project → **Firewalls**
2. Open the firewall attached to the server running MySQL
3. Under **Inbound Rules** → **Add rule**:
   - Protocol: `TCP`
   - Port: `3306`
   - Source: `Any IPv4` (`0.0.0.0/0`)
4. Save

This has to be done manually in the Hetzner console — it cannot be
automated from this repo or from Vercel.

## 2. MySQL server config (`bind-address` / `skip-networking`)

SSH into the server and run the diagnostic script in this repo:

```bash
scp scripts/fix-remote-mysql-access.sh root@YOUR_SERVER_IP:~
ssh root@YOUR_SERVER_IP
bash fix-remote-mysql-access.sh          # diagnose only, makes no changes
bash fix-remote-mysql-access.sh --apply  # diagnose AND fix + restart MySQL
```

What it checks:
- `bind-address` in the MySQL/MariaDB config must **not** be `127.0.0.1`
  (that restricts MySQL to local-only connections — it's the default on a
  fresh install). It should be `0.0.0.0` to accept remote connections.
- `skip-networking` must **not** be present (it disables all TCP/IP
  connections outright).

## 3. MySQL user GRANT host

Even with the firewall and bind-address correct, MySQL still checks which
*host* each user is allowed to connect from. If your app's database user was
created as `'user'@'localhost'`, remote connections are rejected regardless
of network config.

```sql
-- Check current grants:
SELECT user, host FROM mysql.user;

-- If your app's user only shows host = 'localhost', widen it:
ALTER USER 'YOUR_DB_USER'@'localhost' RENAME TO 'YOUR_DB_USER'@'%';
FLUSH PRIVILEGES;
```

## Verify end-to-end

1. From your own machine (not the server): `mysql -h YOUR_SERVER_IP -P 3306 -u YOUR_DB_USER -p`
   — if this connects, the network path works.
2. In the Vercel dashboard → project → **Settings → Environment Variables** →
   add `DATABASE_URL` for **Production** (format:
   `mysql://USER:PASSWORD@HOST:3306/DATABASE`). Do this directly in the
   Vercel dashboard, never by pasting the connection string into a chat.
3. Redeploy (`vercel deploy --prod` or push to `master`).
4. Check `https://your-app.vercel.app/api/health` — it should report
   `{"status":"ok","mode":"database", ...}`.

## Why not just pay for Vercel Static IPs?

Vercel sells a **Static IPs** add-on (Pro/Enterprise, ~$100/month per
project) that gives a fixed outbound IP so you *can* use traditional IP
allowlisting instead of opening `3306` to all IPs. For a small venue app this
is usually not worth the cost — opening the port to all IPs while requiring a
strong password and TLS is an accepted, secure-enough pattern, and is exactly
what Vercel's own docs describe as the fallback for services that need
broad, unauthenticated-by-IP access. Only reach for Static IPs if you need
strict IP-based access control for compliance reasons.

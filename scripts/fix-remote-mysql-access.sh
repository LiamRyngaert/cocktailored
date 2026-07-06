#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Diagnose + fix remote MySQL access from Vercel serverless functions.
#
# Run this ON the Hetzner server itself (over SSH), as root or with sudo.
# It NEVER touches Vercel — only the local MySQL server and its firewall.
#
# Usage:
#   ssh root@YOUR_SERVER_IP
#   bash fix-remote-mysql-access.sh              # diagnose only (safe, read-only)
#   bash fix-remote-mysql-access.sh --apply       # diagnose AND apply the fixes
#
# Background: Vercel serverless functions do not have a static outbound IP on
# the Free/Pro plan, so a self-hosted MySQL server must accept connections from
# any IP (0.0.0.0/0) and rely on a strong password + TLS for security instead
# of IP allowlisting. This script checks and (optionally) fixes the 3
# independent things that must all be correct simultaneously:
#   1. Hetzner Cloud Firewall — inbound rule for TCP/3306 (checked manually,
#      cannot be done via this script — see the printed instructions)
#   2. MySQL bind-address / skip-networking (this script can fix this)
#   3. MySQL user GRANT host (this script can fix this)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

echo "═══════════════════════════════════════════════════════════════"
echo "  1) Hetzner Cloud Firewall — MUST be checked manually"
echo "═══════════════════════════════════════════════════════════════"
echo "This script cannot see or change your Hetzner Cloud Firewall (that lives"
echo "in Hetzner's API/console, not on this server). Go to:"
echo "  https://console.hetzner.cloud → your project → Firewalls"
echo "→ open the firewall attached to this server → Inbound Rules → Add rule:"
echo "    Protocol: TCP   Port: 3306   Source: Any IPv4 (0.0.0.0/0)"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  2) MySQL bind-address / skip-networking"
echo "═══════════════════════════════════════════════════════════════"
CNF_CANDIDATES=(
  /etc/mysql/mysql.conf.d/mysqld.cnf
  /etc/mysql/mariadb.conf.d/50-server.cnf
  /etc/my.cnf
  /etc/mysql/my.cnf
)
CNF_FILE=""
for f in "${CNF_CANDIDATES[@]}"; do
  if [[ -f "$f" ]]; then CNF_FILE="$f"; break; fi
done

if [[ -z "$CNF_FILE" ]]; then
  echo "⚠ Could not find a MySQL/MariaDB config file in the usual locations."
  echo "  Find it yourself with: mysql --help | grep 'Default options' -A1"
else
  echo "Config file: $CNF_FILE"
  CURRENT_BIND=$(grep -E '^\s*bind-address' "$CNF_FILE" || echo "(not set — defaults to 127.0.0.1)")
  SKIP_NET=$(grep -E '^\s*skip-networking' "$CNF_FILE" || echo "(not set — good, networking enabled)")
  echo "  Current bind-address: $CURRENT_BIND"
  echo "  Current skip-networking: $SKIP_NET"

  if echo "$CURRENT_BIND" | grep -q "127.0.0.1"; then
    echo "  ✗ PROBLEM: bind-address is 127.0.0.1 — MySQL only accepts local connections."
    if $APPLY; then
      cp "$CNF_FILE" "$CNF_FILE.bak.$(date +%s)"
      sed -i 's/^\(\s*bind-address\s*=\s*\).*/\10.0.0.0/' "$CNF_FILE"
      echo "  ✓ Fixed: bind-address set to 0.0.0.0 (backup saved next to the file)"
    else
      echo "    Fix: sudo sed -i 's/^\\(bind-address\\s*=\\s*\\).*/\\10.0.0.0/' $CNF_FILE"
    fi
  else
    echo "  ✓ OK: bind-address is not restricted to localhost."
  fi

  if echo "$SKIP_NET" | grep -qv "not set"; then
    echo "  ✗ PROBLEM: skip-networking is present — this disables ALL TCP/IP connections."
    if $APPLY; then
      cp "$CNF_FILE" "$CNF_FILE.bak.$(date +%s)"
      sed -i '/^\s*skip-networking/d' "$CNF_FILE"
      echo "  ✓ Fixed: skip-networking line removed"
    else
      echo "    Fix: sudo sed -i '/^skip-networking/d' $CNF_FILE"
    fi
  else
    echo "  ✓ OK: skip-networking is not set."
  fi
fi
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "  3) MySQL user GRANT host"
echo "═══════════════════════════════════════════════════════════════"
echo "Checking which hosts your MySQL users are allowed to connect from..."
echo "(You will be prompted for the MySQL root password)"
echo ""
mysql -u root -p -e "SELECT user, host FROM mysql.user WHERE user NOT IN ('mysql.sys','mysql.session','mysql.infoschema','root') OR host != 'localhost';" || {
  echo "⚠ Could not query mysql.user — check the root password or run manually:"
  echo "    mysql -u root -p -e \"SELECT user, host FROM mysql.user;\""
}
echo ""
echo "Look at the output above. If your app's database user only shows"
echo "host = 'localhost', it cannot accept remote connections. Fix with:"
echo ""
echo "  mysql -u root -p"
echo "  > ALTER USER 'YOUR_DB_USER'@'localhost' RENAME TO 'YOUR_DB_USER'@'%';"
echo "  > FLUSH PRIVILEGES;"
echo ""
echo "(Replace YOUR_DB_USER with the actual username from DATABASE_URL.)"
echo ""

if $APPLY && [[ -n "$CNF_FILE" ]]; then
  echo "═══════════════════════════════════════════════════════════════"
  echo "  Restarting MySQL to apply config changes..."
  echo "═══════════════════════════════════════════════════════════════"
  if command -v systemctl &> /dev/null; then
    systemctl restart mysql 2>/dev/null || systemctl restart mariadb 2>/dev/null || {
      echo "⚠ Could not restart via systemctl. Restart MySQL manually:"
      echo "    sudo systemctl restart mysql   (or mariadb)"
    }
    echo "✓ MySQL restarted."
  else
    echo "⚠ systemctl not found — restart MySQL manually for your distro."
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Next: verify from OUTSIDE this server"
echo "═══════════════════════════════════════════════════════════════"
echo "From your own laptop (not this server), test:"
echo "  mysql -h YOUR_SERVER_IP -P 3306 -u YOUR_DB_USER -p"
echo "If that connects, the Vercel app will connect too — redeploy it after"
echo "adding DATABASE_URL back in the Vercel dashboard (Settings → Environment"
echo "Variables → Production), then check https://your-app.vercel.app/api/health"

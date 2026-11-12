# Deploy

Day-to-day commands (start, stop, restart, logs, update, backup) are in the [main README](../README.md#running-it-day-to-day).

On a machine that has the project (like a development PC), copy `.env.example` to `.env` right here in `deploy/` and run the commands from this folder. On a server without the project, put `docker-compose.yml` and `.env` in any folder and run them there.

CI builds the server image and publishes it to GHCR
(`ghcr.io/<owner>/notiforwarder-server`), only when you push to the `publish` branch. Deploying is manual.

## On the Ubuntu server
1. Copy `docker-compose.yml` and `.env.example` (as `.env`) into a folder.
2. Set `VERSION` in `.env` to an explicit tag (a short commit SHA, or `latest` for the newest build).
3. If the GHCR package is private: `docker login ghcr.io` with a token that has `read:packages`.
4. `docker compose pull && docker compose up -d`

Roll back by changing `VERSION` and running step 4 again.

CI builds `linux/amd64` and `linux/arm64`; narrow it once you confirm the host with `uname -m`.

## First deploy on a production VM (fresh start)

If the VM has its own PostgreSQL and cloudflared, use the next section instead. Otherwise:

1. Once, on GitHub: make the `notiforwarder-server` and `notiforwarder-web` packages public (Packages, then Package settings, then Change visibility), so the VM needs no login. They contain code only, never `.env`.
2. Copy `docker-compose.yml` and `.env.example` (renamed `.env`) to the VM, never your other machine's `.env`. Fill in the passwords, `PUBLIC_URL`, `VERSION` and `TUNNEL_TOKEN`.
3. `docker compose up -d`, then sign in at `PUBLIC_URL` and pair the phone again.

If you reuse a hostname another machine served, stop that machine's stack first and repoint the hostname to the new tunnel.

## Using your own PostgreSQL and cloudflared

`docker-compose.byo.yml` runs only the dashboard and the server. Three values are required; everything else has a default.

1. **Database.** In your PostgreSQL (13 or newer):
   ```sql
   CREATE ROLE notiforwarder LOGIN PASSWORD 'a-long-random-password';
   CREATE DATABASE notiforwarder OWNER notiforwarder;
   ```
2. **Deploy** the file with these three environment variables (in your manager's env panel, or a `.env` file next to it, see `.env.byo.example`):
   ```
   DATABASE_URL=postgres://notiforwarder:PASSWORD@192.168.1.10:5432/notiforwarder
   PUBLIC_URL=https://notifications.example.com
   ADMIN_PASSWORD=a-passphrase-of-12-or-more-characters
   ```
   Then `docker compose up -d` (or your manager's deploy button). A missing value stops it with a message saying which.
3. **Tunnel.** In Cloudflare, point your hostname at **HTTP** `http://<this machine's address>:3000`. Open your address, sign in as `admin`, and choose **Add phone**.

Defaults you can change: `ADMIN_USERNAME` (admin), `VERSION` (latest; use a `sha-xxxxxxx` tag to pin), `WEB_BIND` (3000, open to your network; `127.0.0.1:3000` means this machine only), `TRUST_PROXY` (2), `GHCR_OWNER` (tianyu-00).

Check it worked: `docker compose logs server` shows `created admin user`.

### If something doesn't work
- **"connection refused" or a timeout to the database, with PostgreSQL on the same machine:** it must accept connections from Docker. Set `listen_addresses` to include the Docker bridge (or `*`), and add `host notiforwarder notiforwarder 172.16.0.0/12 scram-sha-256` to `pg_hba.conf`, then reload PostgreSQL. A database on another machine just needs its address in `DATABASE_URL`.
- **"permission denied for schema public":** the database isn't owned by the `notiforwarder` user. Run `ALTER DATABASE notiforwarder OWNER TO notiforwarder;`.
- **A password with special characters:** URL-encode it inside `DATABASE_URL`.
- **cloudflared is a container and can't reach port 3000:** use the machine's network address in the Cloudflare URL, not `localhost`. Or join the networks: add `docker-compose.byo-network.yml` to `COMPOSE_FILE`, set `CLOUDFLARED_NETWORK`, and use `http://notiforwarder-web:80`.
- **A database that needs TLS:** add `?sslmode=require` to `DATABASE_URL`. Not tried against a real one.
- Back up with your own tools, e.g. `pg_dump -U notiforwarder notiforwarder > backup.sql`. Update with `docker compose pull && docker compose up -d`.

## Public access with a Cloudflare tunnel
Cloudflare presents the HTTPS certificate, so nothing needs opening on your router and there is no certificate to renew. The domain must use Cloudflare DNS.

1. Cloudflare dashboard, **Zero Trust > Networks > Tunnels > Create a tunnel** (type *Cloudflared*). Copy the tunnel token.
2. Add a **Public hostname**, e.g. `notifications.example.com`:
   - Service type **HTTP**.
   - URL `web:80` if you run the bundled cloudflared container, or `localhost:3000` if cloudflared runs on the host.
3. Put the token in `.env` as `TUNNEL_TOKEN`, set `PUBLIC_URL=https://notifications.example.com`, and keep `TRUST_PROXY=2` (cloudflared, then the web container).
4. Start everything: `docker compose up -d`. (`.env` has `COMPOSE_PROFILES=tunnel`, which includes the tunnel; without that line use `docker compose --profile tunnel up -d`.)

Phones and the dashboard then both use `PUBLIC_URL`. The phone API paths (`/api/v1/pair`, `/api/v1/messages`) must stay reachable without a Cloudflare Access login, because the phone app can't complete one.

If Nginx Proxy Manager also sits in the path, there is one more proxy: set `TRUST_PROXY=3`, and in NPM add `proxy_buffering off;` and `proxy_read_timeout 1h;` for `/api/v1/stream` so live updates are not buffered.

# Deploy

Day-to-day commands (start, stop, restart, logs, update, backup) are in the [main README](../README.md#running-it-day-to-day).

On a machine that has the project (like a development PC), copy `.env.example` to `.env` right here in `deploy/` and run the commands from this folder. On a server without the project, put `docker-compose.yml` and `.env` in any folder and run them there.

CI builds the server image and publishes it to GHCR
(`ghcr.io/<owner>/notiforwarder-server`), only when you push to the `publish` branch. Deploying is manual.

## On the Ubuntu server
1. Copy `docker-compose.yml` and `.env.example` (as `.env`) into a folder.
2. Set `VERSION` in `.env` to an explicit tag (a short commit SHA, or `publish` for the newest build).
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

Four steps. This runs only the dashboard and the server; the database and the tunnel are yours.

1. **Database.** In your PostgreSQL (13 or newer):
   ```sql
   CREATE ROLE notiforwarder LOGIN PASSWORD 'a-long-random-password';
   CREATE DATABASE notiforwarder OWNER notiforwarder;
   ```
2. **Files.** Put `docker-compose.byo.yml` and `.env.byo.example` (renamed `.env`) in a folder on the machine. Fill in the five lines marked `<--`.
3. **Start.** `docker compose up -d`
4. **Tunnel.** In Cloudflare, point your hostname at **HTTP** `localhost:3000`. Then open your address, sign in, and choose **Add phone**.

Check it worked: `docker compose logs server` shows `created admin user`.

### If something doesn't work
- **"connection refused" or a timeout to the database, with PostgreSQL on the same machine:** it must accept connections from Docker. Set `listen_addresses` to include the Docker bridge (or `*`), and add `host notiforwarder notiforwarder 172.16.0.0/12 scram-sha-256` to `pg_hba.conf`, then reload PostgreSQL. A database on another machine just needs its address in `DATABASE_URL`.
- **A password with special characters:** URL-encode it inside `DATABASE_URL`.
- **cloudflared is a container, not on the machine itself:** set `COMPOSE_FILE=docker-compose.byo.yml:docker-compose.byo-network.yml` and `CLOUDFLARED_NETWORK=<its network, from docker network ls>` in `.env` (copy `docker-compose.byo-network.yml` too), and use **HTTP** `notiforwarder-web:80` in Cloudflare instead.
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

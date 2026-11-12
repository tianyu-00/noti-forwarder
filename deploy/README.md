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

## First deploy on a production VM (fresh start, public images)

Starts empty: new database, new admin login, phones pair again. Nothing is copied from another machine.

**Once, on GitHub: make the images public** so the VM needs no login. Your profile, **Packages**, then for each of `notiforwarder-server` and `notiforwarder-web`: **Package settings**, **Danger Zone**, **Change visibility**, **Public**. The images hold the app code only, never `.env` or any secret.

**On the VM** (Docker with the compose plugin; `docker --version && docker compose version` to check, and `uname -m` should say `x86_64` or `aarch64`, both are built):

1. Get the two files over, from the machine that has the project. Do not copy its `.env`: it holds that machine's passwords and tunnel token.
   ```bash
   ssh <vm> mkdir -p ~/notiforwarder
   scp deploy/docker-compose.yml deploy/.env.example <vm>:~/notiforwarder/
   ```
2. On the VM:
   ```bash
   cd ~/notiforwarder
   cp .env.example .env && chmod 600 .env
   nano .env
   ```
   Set `GHCR_OWNER`, `VERSION` (a `sha-xxxxxxx` tag from the Packages page, so production only changes when you choose; `publish` always follows the newest build), a new `POSTGRES_PASSWORD` (`openssl rand -base64 24`), `PUBLIC_URL`, `TRUST_PROXY=2`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (12+ characters), and `TUNNEL_TOKEN` with `COMPOSE_PROFILES=tunnel`. Leave `COMPOSE_PROJECT_NAME` alone once the first start has happened.
3. Make a tunnel for this VM (see below), then `docker compose up -d`.
4. Check: `docker compose ps` (four running), `curl localhost:3000/api/v1/health`, and `docker compose logs server` shows `applied migrations` and `created admin user`.
5. Sign in at `PUBLIC_URL`, choose **Add phone**, and scan the code with the app. If the app still shows the old pairing, tap **Unpair this phone** first. Then turn two-step login on again in Settings.
6. Nothing needs opening on the firewall: the tunnel only makes outgoing connections, and port 3000 is bound to `127.0.0.1`.

If you reuse the hostname the old machine served (so the phones keep the same address), stop the old machine's stack first (`docker compose down`, without `-v`) and repoint the hostname to the new tunnel. Two machines connected to one tunnel would split the traffic between two different databases.

Update later with `docker compose pull && docker compose up -d` after changing `VERSION`, and back up with the `pg_dump` command in the main README.

## Using your own PostgreSQL and cloudflared

For a machine that already runs both. `docker-compose.byo.yml` starts only the dashboard (`web`) and the `server`; it has no database and no tunnel of its own. Use it instead of `docker-compose.yml`.

**1. The database** (PostgreSQL 13 or newer, no extensions). Create a user that owns its own database, so the server can create its tables:
```sql
CREATE ROLE notiforwarder LOGIN PASSWORD 'a-long-random-password';
CREATE DATABASE notiforwarder OWNER notiforwarder;
```
The server creates and updates its tables itself on start. If PostgreSQL runs on the same machine as Docker, it must accept connections from Docker's network: listen on more than `localhost` (`listen_addresses`), and allow the Docker address range in `pg_hba.conf`, e.g. `host notiforwarder notiforwarder 172.16.0.0/12 scram-sha-256`, then reload. If it runs elsewhere, use its address. Back it up with your own tooling, e.g. `pg_dump -U notiforwarder notiforwarder > backup.sql`.

**2. Files.** Copy `docker-compose.byo.yml` and `.env.byo.example` (as `.env`) to the machine, plus `docker-compose.byo-network.yml` if you need step 3b. Set `DATABASE_URL`, `PUBLIC_URL`, the admin login and `VERSION`. `COMPOSE_FILE` in that `.env` makes plain `docker compose up -d`, `pull` and `logs` use this file. Passwords with special characters must be URL-encoded in `DATABASE_URL`. A database that requires TLS needs `?sslmode=require` on the URL; this has not been tried against one.

**3. Pointing your cloudflared at it.** The dashboard container listens on `127.0.0.1:3000` of the machine. In the Cloudflare public hostname, use service type **HTTP** and:
- a. cloudflared runs on the machine itself: `localhost:3000`.
- b. cloudflared runs as a container on its own Docker network: set `COMPOSE_FILE=docker-compose.byo.yml:docker-compose.byo-network.yml` and `CLOUDFLARED_NETWORK=<that network's name>` in `.env` (`docker network ls`). The dashboard container is then reachable from the tunnel as `notiforwarder-web:80`.

Keep `TRUST_PROXY=2` (your cloudflared, then the dashboard container). If another proxy sits in front, count it too.

**4. Start and check:** `docker compose up -d`, then `docker compose ps`, `curl localhost:3000/api/v1/health`, and `docker compose logs server` should show `applied migrations` and `created admin user`. Sign in at `PUBLIC_URL`, choose **Add phone**, and pair. Updating later is `docker compose pull && docker compose up -d`.

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

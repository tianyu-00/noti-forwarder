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

If the VM already runs cloudflared, use the next section instead. Otherwise:

1. Once, on GitHub: make the `notiforwarder-server` and `notiforwarder-web` packages public (Packages, then Package settings, then Change visibility), so the VM needs no login. They contain code only, never `.env`.
2. Copy `docker-compose.yml` and `.env.example` (renamed `.env`) to the VM, never your other machine's `.env`. Fill in the passwords, `PUBLIC_URL`, `VERSION` and `TUNNEL_TOKEN`.
3. `docker compose up -d`, then sign in at `PUBLIC_URL` and pair the phone again.

If you reuse a hostname another machine served, stop that machine's stack first and repoint the hostname to the new tunnel.

## Using your own cloudflared

`docker-compose.byo.yml` runs only the dashboard and the server (there is no database to set up: it is one file in the `notiforwarder-data` volume). Two values are required; everything else has a default.

1. **Deploy** the file with these two environment variables (in your manager's env panel, or a `.env` file next to it, see `.env.byo.example`):
   ```
   PUBLIC_URL=https://notifications.example.com
   ADMIN_PASSWORD=a-passphrase-of-12-or-more-characters
   ```
   Then `docker compose up -d` (or your manager's deploy button). A missing value stops it with a message saying which.
2. **Tunnel.** In Cloudflare, point your hostname at **HTTP** `http://<this machine's address>:3000`. Open your address, sign in as `admin`, and choose **Add phone**.

Defaults you can change: `ADMIN_USERNAME` (admin), `VERSION` (latest; use a `sha-xxxxxxx` tag to pin), `WEB_BIND` (3000, open to your network; `127.0.0.1:3000` means this machine only), `TRUST_PROXY` (2), `GHCR_OWNER` (tianyu-00).

Check it worked: `docker compose logs server` shows `created admin user`.

### If something doesn't work
- **cloudflared is a container and can't reach port 3000:** use the machine's network address in the Cloudflare URL, not `localhost`. Or join the networks: add `docker-compose.byo-network.yml` to `COMPOSE_FILE`, set `CLOUDFLARED_NETWORK`, and use `http://notiforwarder-web:80`.
- **The data folder must be on a local disk.** SQLite does not work reliably on a network share (NFS, SMB). The default Docker volume is fine.
- Back up with `docker compose exec -T server node src/backup.js > backup.db` (see the main README). Update with `docker compose pull && docker compose up -d`.

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

## Without a domain (plain http)

Set `PUBLIC_URL` to the address you open the dashboard on, for example `http://192.168.1.20:3000`. With `http://` the server stops marking the session cookie Secure, so signing in sticks. Nothing is encrypted in that mode: use it only on a network you trust. The Android app also accepts `http://` for the server, but only when it is on the phone's own network (192.168.x.x, 10.x.x.x, 172.16-31.x.x, `localhost`, `*.local` or a single-word name such as `rpi-server`). Anything on the internet must use https. Pair the phone while it is on the same Wi-Fi, and it only syncs while it can reach that address.

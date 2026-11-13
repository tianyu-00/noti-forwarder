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

1. Once, on GitHub: make the `notiforwarder-server` and `notiforwarder-web` packages public (Packages, then Package settings, then Change visibility), so the VM needs no login. They contain code only, never `.env`.
2. Copy `docker-compose.yml` and `.env.example` (renamed `.env`) to the VM, never your other machine's `.env`. Fill in the passwords, `PUBLIC_URL` and `VERSION`.
3. `docker compose up -d`, then sign in at `PUBLIC_URL` and pair the phone again.

## The short version: `docker-compose.byo.yml`

`docker-compose.byo.yml` runs only the dashboard and the server (there is no database to set up: it is one file in the `notiforwarder-data` volume). Two values are required; everything else has a default.

1. **Deploy** the file with these two environment variables (in your manager's env panel, or a `.env` file next to it, see `.env.byo.example`):
   ```
   PUBLIC_URL=https://notifications.example.com
   ADMIN_PASSWORD=a-passphrase-of-12-or-more-characters
   ```
   Then `docker compose up -d` (or your manager's deploy button). A missing value stops it with a message saying which.
2. Open `http://<this machine's address>:3000`, sign in as `admin`, and choose **Add phone**.

Defaults you can change: `ADMIN_USERNAME` (admin), `VERSION` (latest; use a `sha-xxxxxxx` tag to pin), `WEB_BIND` (3000, open to your network; `127.0.0.1:3000` means this machine only), `TRUST_PROXY` (2), `GHCR_OWNER` (tianyu-00).

Check it worked: `docker compose logs server` shows `created admin user`.

### If something doesn't work
- **The data folder must be on a local disk.** SQLite does not work reliably on a network share (NFS, SMB). The default Docker volume is fine.
- Back up with `docker compose exec -T server node src/backup.js > backup.db` (see the main README). Update with `docker compose pull && docker compose up -d`.

## HTTPS
Use HTTPS for the full feature set (sign-in cookie, copy buttons, phones on any network). Put the dashboard behind any HTTPS reverse proxy or tunnel you like and point it at port 3000. Plain `http://` works on a local network only. Set `PUBLIC_URL` to the HTTPS address and keep `TRUST_PROXY` at the number of proxies in front of the server (2 by default: your proxy, then the web container).

## Plain http (local network)

Set `PUBLIC_URL` to the address you open the dashboard on, for example `http://192.168.1.20:3000`. With `http://` the server stops marking the session cookie Secure, so signing in sticks. Nothing is encrypted in that mode: use it only on a network you trust. The Android app also accepts `http://` for the server, but only when it is on the phone's own network (192.168.x.x, 10.x.x.x, 172.16-31.x.x, `localhost`, `*.local` or a single-word name such as `rpi-server`). Anything on the internet must use https. Pair the phone while it is on the same Wi-Fi, and it only syncs while it can reach that address.

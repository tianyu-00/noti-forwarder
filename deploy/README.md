# Deploy

Day-to-day commands (start, stop, restart, logs, update, backup) are in the [main README](../README.md#running-it-day-to-day).

`docker-compose.yml` runs two containers: the dashboard (`web`, nginx) and the `server`. There is no database to set up: it is one file in the `notiforwarder-data` volume. CI builds the images and publishes them to GHCR (`ghcr.io/<owner>/notiforwarder-server` and `-web`) only when you push to the `publish` branch. Deploying is manual.

## Set it up

1. Copy `docker-compose.yml` and `.env.example` (as `.env`) into a folder. On a machine that has the project, just use this folder.
2. Set the two required values in `.env`, or in your manager's env panel:
   ```
   PUBLIC_URL=https://notifications.example.com
   ADMIN_PASSWORD=a-passphrase-of-12-or-more-characters
   ```
   A missing value stops it with a message saying which.
3. `docker compose up -d`, then open `http://<this machine's address>:3000`, sign in as `admin`, and choose **Add phone**.

Check it worked: `docker compose logs server` shows `created admin user`.

Defaults you can change (all listed in `.env.example`): `ADMIN_USERNAME` (admin), `VERSION` (latest; use a `sha-xxxxxxx` tag to pin), `WEB_BIND` (3000, open to your network; `127.0.0.1:3000` means this machine only), `TRUST_PROXY` (2), `SILENT_AFTER_MINUTES` (120), `GHCR_OWNER` (tianyu-00).

## Updating and rolling back

`docker compose pull && docker compose up -d`. To roll back, set `VERSION` in `.env` to an older `sha-xxxxxxx` tag and run it again. If the GHCR packages are private, `docker login ghcr.io` first with a token that has `read:packages`; making the `notiforwarder-server` and `notiforwarder-web` packages public (Packages, then Package settings, then Change visibility) means no login is needed. They contain code only, never `.env`.

CI builds `linux/amd64` and `linux/arm64`.

## If something doesn't work

- **The data folder must be on a local disk.** SQLite does not work reliably on a network share (NFS, SMB). The default Docker volume is fine.
- **The data volume's name.** It is `<project name>_notiforwarder-data`, so keep `COMPOSE_PROJECT_NAME` fixed. An older version of this file kept the database in a volume called `<project name>_data`; if your messages seem to be gone after switching to this file, they are still in that old volume: change the volume name in the compose file to match, or copy the data across.
- Back up with `docker compose exec -T server node src/backup.js > backup.db` (see the main README).

## HTTPS

Use HTTPS for the full feature set (sign-in cookie, copy buttons, phones on any network). Put the dashboard behind any HTTPS reverse proxy or tunnel you like and point it at port 3000. Plain `http://` works on a local network only. Set `PUBLIC_URL` to the HTTPS address and keep `TRUST_PROXY` at the number of proxies in front of the server (2 by default: your proxy, then the web container).

## Plain http (local network)

Set `PUBLIC_URL` to the address you open the dashboard on, for example `http://192.168.1.20:3000`. With `http://` the server stops marking the session cookie Secure, so signing in sticks. Nothing is encrypted in that mode: use it only on a network you trust. The Android app also accepts `http://` for the server, but only when it is on the phone's own network (192.168.x.x, 10.x.x.x, 172.16-31.x.x, `localhost`, `*.local` or a single-word name such as `rpi-server`). Anything on the internet must use https. Pair the phone while it is on the same Wi-Fi, and it only syncs while it can reach that address.

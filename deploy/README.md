# Deploy

Day-to-day commands (start, stop, restart, logs, update, backup) are in the [main README](../README.md#running-it-day-to-day).

CI builds the server image and publishes it to GHCR
(`ghcr.io/<owner>/notiforwarder-server`), only when you push to the `publish` branch. Deploying is manual.

## On the Ubuntu server
1. Copy `docker-compose.yml` and `.env.example` (as `.env`) into a folder.
2. Set `VERSION` in `.env` to an explicit tag (a short commit SHA, or `publish` for the newest build).
3. If the GHCR package is private: `docker login ghcr.io` with a token that has `read:packages`.
4. `docker compose pull && docker compose up -d`

Roll back by changing `VERSION` and running step 4 again.

CI builds `linux/amd64` and `linux/arm64`; narrow it once you confirm the host with `uname -m`.

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

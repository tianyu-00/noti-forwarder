# Notiforwarder

Self-hosted system that captures SMS and app notifications from Android phones and shows them
in one place: a web dashboard you can open from a PC or phone. Phones send over HTTPS through a
Cloudflare tunnel, and every message is queued on the phone first, so nothing is lost offline.

| Folder | What it is |
|---|---|
| `android/` | The phone app (Kotlin) |
| `server/` | The API (Node.js + Postgres) |
| `web/` | The dashboard (React) |
| `deploy/` | `docker-compose.yml` and example settings |

Design notes and project rules are in [CLAUDE.md](CLAUDE.md).

## Running it (day to day)

It runs from the project's **`deploy/`** folder, using the private **`deploy/.env`** (passwords and
tunnel token; git ignores it). Run every command below from there:

```bash
cd ~/github/noti-forwarder/deploy
```

| I want to... | Command |
|---|---|
| **Start** everything (also after a reboot) | `docker compose up -d` |
| **Stop** everything (your data is kept) | `docker compose down` |
| **Restart** everything | `docker compose restart` |
| Restart one part (`server`, `web`, `db`, `cloudflared`) | `docker compose restart server` |
| See what is running | `docker compose ps` |
| Watch the server's log (Ctrl+C stops watching) | `docker compose logs -f server` |
| Check the tunnel | `docker compose logs --tail 30 cloudflared` |

Two lines in `.env` matter for these plain commands:
- `COMPOSE_PROFILES=tunnel` makes them include the Cloudflare tunnel. If it is ever missing, add
  `--profile tunnel` after `docker compose` (for example `docker compose --profile tunnel up -d`),
  otherwise the site stays unreachable.
- `COMPOSE_PROJECT_NAME=notiforwarder-run` keeps the database volume from before the stack moved
  into `deploy/`. Do not change it, or Docker will start a new, empty database.

### Check that it works
Open `<your PUBLIC_URL>/api/v1/health` in a browser. It should show a version and a commit.
If the site does not load: run `docker compose ps` (all four should say `running`), then
`docker compose logs --tail 30 cloudflared` (look for "Registered tunnel connection").

### After the PC or WSL restarts
The containers are set to restart by themselves (`restart: unless-stopped`), but only once Docker
is running again. Start Docker (and WSL) first. If nothing is running afterwards, run
`docker compose up -d`. A phone that was offline sends everything it queued as soon as the
server is reachable again.

### Update to a newer version
New images are built when you push to the `publish` branch (`git push origin main:publish`).
Then, in the run folder:

```bash
docker compose pull
docker compose up -d
```

To go back to an older build, set `VERSION` in `.env` to an older tag (a `sha-...` tag) and run
`docker compose up -d` again.

### Back up and restore the database
Messages live in a Docker volume. To make a backup file:

```bash
docker compose exec -T db pg_dump -U notiforwarder notiforwarder > backup-$(date +%F).sql
```

To restore one into a fresh, empty database:

```bash
docker compose exec -T db psql -U notiforwarder notiforwarder < backup-2026-11-12.sql
```

### Careful
- `docker compose down -v` also **deletes the database** (the `-v`). Never add it unless you
  really want to erase every message.
- Never commit `.env` or paste the tunnel token or passwords anywhere. They belong only in that
  file.
- `git clean -fdx` deletes ignored files, including `deploy/.env`. Do not run it in this project
  without copying `.env` somewhere safe first.
- `deploy/docker-compose.yml` is tracked by git. After a `git pull`, run `docker compose up -d`
  to apply any change to it.

## Keeping and deleting messages

- **Settings** (top right of the dashboard) sets how long messages are kept: forever (the default) or delete everything older than N days. Saving a limit deletes the older messages at once and the server repeats it every hour. This cannot be undone, so the dashboard asks first.
- **Erase a phone**: revoke it first, then open it and choose *Erase this phone and its messages*. The phone entry and all its messages are removed.

## Push alerts with ntfy

The server can send an alert to your main phone for each new message, through
[ntfy](https://ntfy.sh). A message with a 2FA code gets a title like `🔑 482913 · Kitchen phone ·
SMS from BANK` and a higher priority, so the code shows on the lock screen.

**Set it up**
1. Install the **ntfy** app on the phone that should get the alerts.
2. Make up a long random topic name (20+ characters), for example `openssl rand -hex 16`.
3. In the ntfy app, tap **+**, enter that topic, and keep the default server (`ntfy.sh`).
4. Put the same topic in `deploy/.env` as `NTFY_TOPIC=...`, then apply it from `deploy/`:
   `docker compose up -d`
5. Check `docker compose logs server | grep ntfy`. It should say `ntfy push enabled`.

**Choose what gets pushed** (all optional, in `deploy/.env`; leave a line blank to use the default)

| Setting | Meaning |
|---|---|
| `NTFY_MODE` | `all` = every message (default), `codes` = only messages containing a 2FA code |
| `NTFY_TYPES` | `sms,notification` (default), or just `sms` / `notification` |
| `NTFY_APPS_BLOCK` | Apps that never push, as a comma list of package names, e.g. `com.game,com.news` |
| `NTFY_INCLUDE_BODY` | `false` = alerts only say "New message", with no text, sender, app or code |
| `NTFY_URL` | `https://ntfy.sh` (default) or your own ntfy server (https) |
| `NTFY_TOKEN` | An access token, only if your ntfy server requires one |

A burst of messages sends at most 5 alerts plus one "+N more" summary. A failed push never stops a
message from being stored, and the logs never contain message text.

**Privacy, please read.** A push carries the message text, including 2FA codes. On the public
`ntfy.sh`, that text passes through ntfy's servers, and **anyone who learns your topic can read
your alerts**. Keep the topic secret, treat it like a password, and never share it. If you do not
want the text to leave your server, set `NTFY_INCLUDE_BODY=false`, or run your own ntfy server.
The server refuses to start with a short topic on `ntfy.sh`, or with plain `http` to a remote server.

More about the server install and the Cloudflare tunnel: [deploy/README.md](deploy/README.md).

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

The running copy lives in its own folder, **`~/notiforwarder-run`** (it holds `docker-compose.yml`
and a private `.env` with the passwords and tunnel token). Run every command below from there:

```bash
cd ~/notiforwarder-run
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

The `.env` file contains `COMPOSE_PROFILES=tunnel`, which is what makes these plain commands
include the Cloudflare tunnel. If that line is ever missing, add `--profile tunnel` after
`docker compose` (for example `docker compose --profile tunnel up -d`), otherwise the site stays
unreachable.

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

More about the server install and the Cloudflare tunnel: [deploy/README.md](deploy/README.md).

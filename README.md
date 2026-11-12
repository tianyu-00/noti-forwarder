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

### Reaching a stack in WSL from your phone (local testing)
With WSL in mirrored networking mode, Windows blocks other devices from reaching a port a
container publishes, so a phone on the same Wi-Fi times out. Open the port once, in PowerShell
as Administrator (port 3100 is the local test stack):

```powershell
New-NetFirewallHyperVRule -Name "NotiforwarderLocal" -DisplayName "Notiforwarder local test" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 3100
```

Undo it when you are done testing:

```powershell
Remove-NetFirewallHyperVRule -Name "NotiforwarderLocal"
```

Only needed on Windows with WSL. A Raspberry Pi or other Linux server needs no such rule.

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

## Android app releases

Every time you publish (`git push origin main:publish`), CI also builds the Android app and attaches it to a **GitHub Release** named after the version (for example `v0.1.57`). Download `notiforwarder-0.1.57.apk` from the repository's Releases page on your phone and install it. The version is `MAJOR.MINOR` from the `VERSION` file plus the CI run number, and the server and web images carry the same number (see the footer of the dashboard). To start `0.2.x`, change `VERSION` to `0.2`.

**One-time setup so the app can update in place.** An update only installs over the old app if both are signed with the same key. Make one key and keep it forever:

```bash
keytool -genkeypair -keystore notiforwarder-release.jks -alias notiforwarder -keyalg RSA -keysize 4096 -validity 36500
base64 -w0 notiforwarder-release.jks    # copy the output
```

In the GitHub repository open **Settings**, **Secrets and variables**, **Actions**, and add four secrets: `ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`notiforwarder`) and `ANDROID_KEY_PASSWORD`. Back the `.jks` file up somewhere safe and do not commit it: if you lose it, phones must uninstall the app before they can install a build signed with a new key. Without these secrets CI still builds, but signs with a throwaway debug key and prints a warning.

Moving to the first release-signed build means uninstalling the debug-signed app once, which removes its pairing, so pair the phone again afterwards.

## Two-step login

Optional but recommended, because messages hold 2FA codes for your other accounts. In the dashboard open **Account**, then **Two-step login**, and choose *Turn on*. Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password…), type the code it shows, and **save the 10 backup codes** (each works once, and they are shown only once). From then on the sign-in form asks for a code after your password.

Lost your phone and the backup codes? Turn it off from the server:

```bash
cd ~/github/noti-forwarder/deploy
docker compose exec server node src/reset-totp.js admin
```

To also encrypt the authenticator secret inside the database, set `SECRET_KEY` (32 or more characters, for example from `openssl rand -base64 32`) in `.env` before or after turning two-step login on. A stolen database backup then does not contain the secret. Keep the key safe and do not change it: while a secret is stored, the server refuses to start with a missing or different key. If you lose the key, run the reset command above and set up two-step login again.

## End-to-end encryption

Optional. With it on, the server only ever stores scrambled text, so even someone with your database or a backup of it cannot read your messages or 2FA codes. In the dashboard open **Settings**, then **End-to-end encryption**, and choose *Create key*. The key is made in your browser and stays there; it is never sent to the server.

- **New phones:** *Add phone* now puts the key in the QR code (and shows it for typing by hand). A phone paired this way encrypts the sender and text before sending. The app shows "End-to-end encrypted" on its connection card.
- **Phones paired before:** they keep sending readable text until you unpair them and pair again.
- **Another browser:** open Settings there, paste the key into *Already have a key from another browser?* (use *Show key* to read it on the first one).
- **What the server can still see:** which app, whether it is an SMS, and when. Not the sender or the text.
- **What changes:** search happens in the browser (over the messages loaded so far), the 2FA code is found after decrypting, and ntfy push alerts say "New message" without text.
- **Keep the key safe.** If you lose it, the encrypted messages cannot be read by anyone, including you. Clearing the browser's site data forgets the key too.

## Connection dot and instant revoke

Each phone keeps one open connection to your server (the same kind of connection the dashboard uses for live updates, so nothing polls). While it is open the phone shows a soft pulsing **green dot** and "Online"; when it drops the dot stops and the sidebar says "Last seen…". A phone that loses its network (airplane mode, no signal) never closes the connection, so the server cannot see it go; instead the app sends a tiny check-in every 25 seconds, and a phone silent for 60 seconds is shown as offline. That costs one small request per 25 seconds while connected. When the phone gets a network back (after a reboot, airplane mode, or switching between Wi-Fi and mobile data) it reconnects within a couple of seconds. "Online" means connected and nothing else: a phone seen a minute ago but not connected shows "Last seen 1 min ago". That connection also works the other way: when you **revoke** a phone in the dashboard the server tells it straight away and the app shows "unpaired". When you tap **Unpair this phone** in the app, the app tells the server first, so the dashboard shows it as revoked at once. If the phone has no connection at that moment, it still unpairs itself, and the dashboard shows it as quiet until you revoke it there.

If Android puts the phone into deep sleep and drops the connection, the 15-minute check-in described below is the fallback: a revoke then reaches the phone within about 15 minutes. Excluding the app from battery optimisation (the app asks for it) keeps the connection up.

## Silent-phone alerts

Android sometimes kills the app, or a user turns off Notification access, and then messages silently stop. To catch that, each phone checks in about every 15 minutes even when it has nothing to send. A phone not heard from for `SILENT_AFTER_MINUTES` (default 120, `0` turns it off) shows **Quiet for 3 h** in red in the sidebar, and if ntfy push is on you get one alert when it goes quiet and one when it is back. Check the app is running, Notification access is still on, and the battery and auto-start settings for the app. A phone still running an older version of the app never checks in, so it shows as quiet once it has been idle for that long. Update the app on every phone.

## Changing the password

**Account**, then **Change password**. It asks for the current password and signs out every other browser. (`ADMIN_PASSWORD` in the environment only matters the first time the server starts.)

## Keeping and deleting messages

- **Clear all messages** is a button on the *All phones* page (to clear a single phone, open it and use *Manage phone*). It deletes every phone's messages at once and the phones stay paired.
- **Settings** (top right of the dashboard) sets how long messages are kept: forever (the default) or delete everything older than N days. Saving a limit deletes the older messages at once and the server repeats it every hour. This cannot be undone, so the dashboard asks first.
- **Clear a phone's messages**: select the phone, choose *Manage phone*, then *Clear messages*. Its messages are deleted; the phone stays paired and keeps sending. No revoke needed.
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

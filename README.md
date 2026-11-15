# Notiforwarder

Self-hosted system that captures SMS and app notifications from Android phones and shows them
in one place: a web dashboard you can open from a PC or phone. Phones send over HTTPS, and every message is queued on the phone first, so nothing is lost offline.

| Folder | What it is |
|---|---|
| `android/` | The phone app (Kotlin) |
| `server/` | The API (Node.js + SQLite) |
| `web/` | The dashboard (React) |
| `deploy/` | `docker-compose.yml` and example settings |

Design notes and project rules are in [CLAUDE.md](CLAUDE.md).

## Running it (day to day)

It runs from the project's **`deploy/`** folder, using the private **`deploy/.env`** (passwords; git ignores it). Run every command below from there:

```bash
cd ~/github/noti-forwarder/deploy
```

| I want to... | Command |
|---|---|
| **Start** everything (also after a reboot) | `docker compose up -d` |
| **Stop** everything (your data is kept) | `docker compose down` |
| **Restart** everything | `docker compose restart` |
| Restart one part (`server`, `web`) | `docker compose restart server` |
| See what is running | `docker compose ps` |
| Watch the server's log (Ctrl+C stops watching) | `docker compose logs -f server` |

One line in `.env` matters for these plain commands:
- `COMPOSE_PROJECT_NAME=notiforwarder-run` keeps the database volume from before the stack moved
  into `deploy/`. Do not change it, or Docker will start a new, empty database.

### Check that it works
Open `<your PUBLIC_URL>/api/v1/health` in a browser. It should show a version and a commit.
If the site does not load: run `docker compose ps` (`web` and `server` should say `running`), then check that your HTTPS proxy points at port 3000.

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
Everything (messages, phones, your login) is one file, `notiforwarder.db`, in the `data` Docker
volume. To make a backup file while it is running:

```bash
docker compose exec -T server node src/backup.js > backup-$(date +%F).db
```

Do not copy the file out of the volume by hand while the server runs: it can be caught half-written.
Keep the backup somewhere safe. Anyone who has it has your messages.

To restore one, stop the server, put the file in place and start it again:

```bash
docker compose stop server
docker compose run --rm --no-deps -v "$PWD/backup-2026-11-12.db:/restore.db:ro" server \
  sh -c 'rm -f /data/notiforwarder.db-wal /data/notiforwarder.db-shm && cp /restore.db /data/notiforwarder.db'
docker compose start server
```

### Careful
- `docker compose down -v` also **deletes the database** (the `-v`). Never add it unless you
  really want to erase every message.
- Never commit `.env` or paste passwords anywhere. They belong only in that
  file.
- `git clean -fdx` deletes ignored files, including `deploy/.env`. Do not run it in this project
  without copying `.env` somewhere safe first.
- `deploy/docker-compose.yml` is tracked by git. After a `git pull`, run `docker compose up -d`
  to apply any change to it.

## Android app releases

Every time you publish (`git push origin main:publish`), CI also builds the Android app and attaches it to a **GitHub Release** named after the version (for example `v0.1.57`). Download `notiforwarder-0.1.57.apk` from the repository's Releases page on your phone and install it. The version is `MAJOR.MINOR` from the `VERSION` file plus the CI run number, and the server and web images carry the same number (see the footer of the dashboard). To start `0.2.x`, change `VERSION` to `0.2`.

### One-time setup: the signing key

An update only installs over the old app if both are signed with the **same key**. Make one key, keep it forever, and give it to CI as four GitHub secrets. Without them CI still builds, but signs with a throwaway debug key and prints a warning, and phones then cannot update in place.

1. **Create the key.** In a terminal on your PC (the WSL/Ubuntu one if you use Windows; the path below is where the Android tools live in this project, so adjust it if yours differs):
   ```bash
   $HOME/android-dev/jdk/bin/keytool -genkeypair -v -keystore ~/notiforwarder-release.jks \
     -alias notiforwarder -keyalg RSA -keysize 4096 -validity 10000
   ```
   It asks for a **keystore password** (choose a long one, you will type it twice, nothing shows as you type) and then name questions. You have no company, and that is fine: the name fields are only a label inside the certificate, so press **Enter** to skip each one and answer `yes` at the end. If it asks for a separate key password, press Enter to use the same one. The file is saved as `~/notiforwarder-release.jks`, outside the repository (`*.jks` is also git-ignored). To start over, delete the file first (`rm ~/notiforwarder-release.jks`), because keytool will not overwrite it.
2. **Turn the key file into text** so it can live in a GitHub secret, and copy it:
   ```bash
   base64 -w0 ~/notiforwarder-release.jks | clip.exe
   ```
   Nothing prints, and the long text is now on your Windows clipboard (`| clip.exe` is what copies it). On plain Linux, leave that part off, run `base64 -w0 ~/notiforwarder-release.jks`, and select and copy the printed line.
3. **Add four secrets** in the GitHub repository: **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Paste the clipboard text first, before copying anything else.

   | Name | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the long text from step 2 |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password you chose |
   | `ANDROID_KEY_ALIAS` | `notiforwarder` |
   | `ANDROID_KEY_PASSWORD` | the same password again (with this key format both are the same value) |

   Never paste these values into a chat, an issue or a commit.
4. **Back up** `~/notiforwarder-release.jks` and its password in a safe place (a password manager, plus a second copy of the file). If you lose either, every phone must uninstall the app before it can install a build signed with a new key.
5. **Publish** (`git push origin main:publish`). The CI log for the Android release no longer shows the "signing with the debug key" warning. To check a downloaded APK yourself: `$ANDROID_HOME/build-tools/<version>/apksigner verify --print-certs notiforwarder-<version>.apk` prints the certificate, and it should be the same for every release.

Moving to the first release-signed build means uninstalling the debug-signed app once, which removes its pairing, so pair the phone again afterwards.

### Updating from inside the app

On the phone, open **Settings**, then **App updates**, and tap **Check for updates**. If a newer release exists, it shows the version and a **Download and install** button. The app downloads the APK from GitHub (only from GitHub, over https, checked for size and checksum) and hands it to Android, which asks you to confirm. The first time, Android sends you to a page to allow this app to install apps; allow it and come back.

It only works between builds signed with the same key (see the setup above). Between different keys Android refuses the update, and the app says so and tells you to uninstall once.

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
- **What changes:** search happens in the browser (over the messages loaded so far), the 2FA code is found after decrypting, and a receiver phone decrypts messages itself.
- **Keep the key safe.** If you lose it, the encrypted messages cannot be read by anyone, including you. Clearing the browser's site data forgets the key too.

## Connection dot and instant revoke

Each phone keeps one open connection to your server (the same kind of connection the dashboard uses for live updates, so nothing polls). While it is open the phone shows a soft pulsing **green dot** and "Online"; when it drops the dot stops and the sidebar says "Last seen…". A phone that loses its network (airplane mode, no signal) never closes the connection, so the server cannot see it go; instead the app sends a tiny check-in every 25 seconds, and a phone silent for 60 seconds is shown as offline. That costs one small request per 25 seconds while connected. When the phone gets a network back (after a reboot, airplane mode, or switching between Wi-Fi and mobile data) it reconnects within a couple of seconds. "Online" means connected and nothing else: a phone seen a minute ago but not connected shows "Last seen 1 min ago". The app's connection card shows the same thing from the phone's side: "Connected to the server", or "Reconnecting…" while it is trying. That connection also works the other way: when you **revoke** a phone in the dashboard the server tells it straight away and the app shows "unpaired". When you tap **Unpair this phone** in the app, the app tells the server first, so the dashboard shows it as revoked at once. If the phone has no connection at that moment, it still unpairs itself, and the dashboard shows it as quiet until you revoke it there.

If Android puts the phone into deep sleep and drops the connection, the 15-minute check-in described below is the fallback: a revoke then reaches the phone within about 15 minutes. Excluding the app from battery optimisation (the app asks for it) keeps the connection up.

## Quiet phones

Android sometimes kills the app, or a user turns off Notification access, and then messages silently stop. To catch that, each phone checks in about every 15 minutes even when it has nothing to send. A phone not heard from for `SILENT_AFTER_MINUTES` (default 120, `0` turns it off) shows **Quiet for 3 h** in red in the sidebar. Check the app is running, Notification access is still on, and the battery and auto-start settings for the app. A phone still running an older version of the app never checks in, so it shows as quiet once it has been idle for that long. Update the app on every phone.

## Changing the password

**Account**, then **Change password**. It asks for the current password and signs out every other browser. (`ADMIN_PASSWORD` in the environment only matters the first time the server starts.)

## Keeping and deleting messages

- **Clear all messages** is a button on the *All phones* page (to clear a single phone, open it and use *Manage phone*). It deletes every phone's messages at once and the phones stay paired.
- **Settings** (top right of the dashboard) sets how long messages are kept: forever (the default) or delete everything older than N days. Saving a limit deletes the older messages at once and the server repeats it every hour. This cannot be undone, so the dashboard asks first.
- **Clear a phone's messages**: select the phone, choose *Manage phone*, then *Clear messages*. Its messages are deleted; the phone stays paired and keeps sending. No revoke needed.
- **Erase a phone**: revoke it first, then open it and choose *Erase this phone and its messages*. The phone entry and all its messages are removed.

## Alerts on your main phone (receiver)

The same Android app can be a **receiver**: the phone where you want to see alerts. On first open the app asks *Sender* or *Receiver*; pick Receiver on your main phone.

**Set it up**
1. In the dashboard choose **Add phone**, then **Receiver**.
2. In the app, pick Receiver and scan the QR code (or type the address and key).
3. Allow notifications and set battery use to unrestricted, so alerts arrive with the screen off.

**What it does**
- Each new message from your sender phones shows as a notification with the real text and sender. A 2FA code gets its own alert with a **Copy code** button.
- Its Alerts tab keeps the latest messages, in step with the dashboard: delete messages there (or let the retention setting purge them) and they disappear from the phone and its notifications.
- With end-to-end encryption on, the receiver decrypts on the phone, using the key from the QR code. Nothing readable passes through any third party.
- **Alert settings** (Settings tab) choose all messages or 2FA codes only, texts and/or app notifications, and which apps are silenced.
- A receiver has its own limited token: it can read messages but never send, and revoking it in the dashboard stops it at once. One role per phone at a time; **Unpair this phone** returns to the Sender or Receiver choice.

More about the server install and HTTPS: [deploy/README.md](deploy/README.md).

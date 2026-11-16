# Notiforwarder

Self-hosted system that captures SMS and app notifications from multiple Android phones and syncs them to one central place, viewable on a PC and on a main Android phone.

## Goals

- Many source phones -> one server -> many viewers (PC browser, main Android phone).
- Capture SMS and all app notifications (banking, delivery, 2FA, etc.).
- Self-hosted on an Ubuntu server with Docker Compose, exposed via Cloudflare tunnel.
- Reliable: no message lost when a phone drops offline.
- Later: reply to SMS from the PC.

## Product requirements

### Phone app (sender)

- Captures all notifications and SMS on the phone and sends them to the server.
- Settings (all stored on the phone, applied before anything is sent, so filtered items never leave the device):
  - Toggle: send SMS (on/off).
  - Toggle: send notifications (on/off). Either, neither or both can be enabled.
  - App blacklist: list of installed apps with search; the user switches off any app whose notifications should not be sent. Default: everything allowed except this app's own notifications and noisy system/ongoing/foreground-service notifications.
- Pairing screen: scan the QR code shown on the web dashboard, or type the server address and security key by hand.
- Shows connection status (paired/unpaired, last successful send, queued count).
- Offline-safe: every captured message is written to a local queue first and only deleted after the server confirms. Retries with backoff when there is no internet, and flushes automatically when connectivity returns or the app restarts.

### Web dashboard (viewer)

- Receives and displays notifications and SMS from all phones in real time.
- Sidebar lists all connected phones (name, online/last-seen, unread count). Default view is "All phones" showing every message from every phone, newest first. Selecting a phone shows only that phone's messages.
- Within any view: filter by type (All / SMS / Notifications), filter by app, and search.
- Connections are created on the web side: "Add phone" generates a pairing QR code and security key. The dashboard also lets the user rename a phone and revoke it.
- Messages are stored in the database permanently (retention setting optional), so nothing is lost even if no dashboard is open.

### Pairing flow

1. User logs in to the web dashboard and clicks "Add phone".
2. Server creates a pairing code: random (at least 128 bits), single-use, expires after 10 minutes. The dashboard shows it as a QR code (encoding server URL + code) and as a typeable security key.
3. In the phone app the user scans the QR code or enters the server URL and key.
4. Phone calls `POST /api/v1/pair` with the code, device name, model and app version. The server validates and burns the code, creates the device and returns a long-lived device token.
5. The phone stores the token in the Android Keystore / EncryptedSharedPreferences. The server stores only a hash of the token.
6. The dashboard updates live to show the new phone as connected. From then on the phone sends messages with `Authorization: Bearer <device token>`.
7. Revoking a phone in the dashboard invalidates its token; the phone gets `401` and shows itself as unpaired. Revoked devices' old messages are kept unless the user deletes them.

### Public access and security

The phone sends to a public domain (via Cloudflare tunnel), so it works from any network. Because messages contain private data and 2FA codes, treat the server as internet-facing:

- HTTPS for anything on the internet. Redirect HTTP, enable HSTS. Not everyone has a domain, so plain `http://` is allowed on the local network only: the server sets a non-Secure session cookie when `PUBLIC_URL` starts with `http://`, and the Android app accepts `http://` only for private addresses (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x, `localhost`, single-word names, `*.local`). Android cannot limit cleartext to IP ranges, so the manifest sets `usesCleartextTraffic=true` and `LocalNetwork.kt` plus an OkHttp interceptor in `Http.kt` do the refusing (no redirects followed). IPv6 is not treated as local.
- Web login required: single-user to start. Password hashed with argon2 (or bcrypt), httpOnly + Secure + SameSite session cookie, login rate limiting and lockout, CSRF protection. TOTP 2FA as a follow-up.
- Device tokens: long random, hashed at rest, per device, revocable, never logged. Pairing codes are single-use and short-lived.
- Rate limiting and request size limits on every endpoint; strict input validation (schema validation on all payloads); Helmet security headers; CORS restricted to the dashboard origin.
- Render notification/SMS text as plain text only. Never use `dangerouslySetInnerHTML`; treat all message content as untrusted input (XSS).
- No message bodies in logs. Audit log for pairings, revocations and logins.
- End-to-end encryption (built, opt-in): the dashboard makes a 256-bit key in the browser (kept in localStorage, never sent to the server) and puts it in the pairing QR as `k`. A phone paired with a key encrypts `sender` and `body` with AES-256-GCM before sending; `app`, `type`, `received_at` and the ids stay readable so filters work. Stored format in the same `body`/`sender` columns (no schema change): `e2e:v1:` + base64url(nonce12 | ciphertext | tag16), AAD `nf-e2e-v1:<field>`. The nonce is HMAC-SHA256(key, `nf-e2e-v1-nonce|field|app|receivedAtMs|plaintext`)[:12], so a repeat gives identical bytes and the server's `dedupe_hash` still works. The server cannot read these messages: `code` is null for them (the dashboard finds it after decrypting, `web/src/codes.js`, a copy of `server/src/codes.js`), a receiver phone decrypts on the phone itself, and search runs in the browser. Decrypting uses `@noble/ciphers` because `crypto.subtle` is unavailable on plain http. Android: `E2eCipher.kt`; web: `e2e.js`, `readable.js`, `keyStore.js`. A shared test vector (`web/test/e2e.test.js` and `E2eCipherTest.kt`) keeps the two in step. Phones paired earlier keep sending plain text until paired again. A lost key means the encrypted messages are unreadable.
- Optional hardening later: Cloudflare Access in front of the dashboard (leaving the phone API path open), certificate pinning in the app.

## Architecture

```
[Source phones: OnePlus 7T Pro]
  Kotlin app (NotificationListenerService + SMS receiver)
  -> local queue (Room) -> HTTPS POST (retry)
                |
                v
[Ubuntu server, Docker Compose]
  api (Node.js/Express) -> SQLite (one file)
  -> WebSocket/SSE push to viewers
  -> SSE to receiver phones (the main phone's own app shows the alerts)
                |
                v
[Viewers] React dashboard (PWA) on PC; main Android phone running the receiver app
```

## Repo layout (monorepo)

```
/android     Kotlin Android app (sender)
/server      Node.js API + SQLite migrations
/web         React dashboard (PWA)
/deploy      docker-compose.yml, .env.example
```

## Tech stack

- Android: Kotlin, `NotificationListenerService`, `BroadcastReceiver` for `SMS_RECEIVED`, foreground service, Room for the offline queue, OkHttp/Retrofit.
- Server: Node.js (Express), SQLite (`better-sqlite3`, one file in a Docker volume), SSE, Docker Compose. Chosen over Postgres for the easiest possible install: one fewer container, no password, one-file backup.
- Web: React + Tailwind CSS + Radix UI (primitives, styled with Tailwind; shadcn/ui-style composition is fine). Built as a PWA (installable on the phone). Use Vite for the build. Plain JavaScript (JSX), no TypeScript; use ESLint and prop validation where helpful.
- Deployment: Ubuntu server running Docker Compose, Cloudflare tunnel in front, Nginx Proxy Manager where applicable. Confirm the host CPU architecture (amd64 vs arm64) before pinning images.

## Data model

Table `messages`:

- `id` (uuid, generated by the phone so retries are idempotent)
- `device_id` (text, which phone sent it)
- `type` (`sms` | `notification`)
- `app` (package name, or `sms`)
- `sim` (nullable integer; the phone's subscription id of the SIM that received a text, sent by the phone as `sim` on SMS only, never encrypted; notifications and older phones have none)
- `app_label` (nullable; the app's real name as the phone shows it, e.g. `Gmail`, sent by the phone as `appLabel` on notifications only, never encrypted; older phones and older rows have none and the dashboard falls back to the package name)
- `sender` / `title`
- `body`
- `received_at` (timestamptz, from the phone)
- `created_at` (timestamptz, server)
- `dedupe_hash` (hash of device + app + sender + body + the phone's exact timestamp to the millisecond; so only the same notification delivered twice is dropped, and the same text arriving later is kept)

Table `devices`: `device_id`, `name`, `model`, `app_version`, `token_hash`, `paired_at`, `last_seen`, `revoked_at`, `role` (`sender` or `receiver`, default `sender`; migration 004), `sims` (JSON text, null until the phone reports: `{sims: [{id, slot, name, allowed}], replies: {on, permission, practice}}`; the older plain SIM array is still read; migration 003), `battery_percent` (0 to 100) and `battery_charging` (0 or 1), both null until a phone reports its battery (migration 005).

Table `pairing_codes`: `code_hash`, `created_at`, `expires_at`, `used_at`, `device_id` (set when used), `role` (the kind of phone the code makes, default `sender`).

Table `users`: `id`, `username`, `password_hash`, `totp_secret` (set while 2FA setup is pending and once on), `totp_enabled_at`, `totp_last_step` (replay guard), `failed_logins`, `locked_until`. Table `totp_backup_codes`: `code_hash`, `user_id`, `used_at` (10 one-use recovery codes, hashed). Sessions stored server-side or as signed cookies.

Table `settings`: `key`, `value` (jsonb), `updated_at`. Holds dashboard settings; today only `retention_days` (absent = keep messages forever).

Table `audit_log`: `id`, `event` (login, pair, revoke, ...), `actor`, `device_id`, `ip`, `created_at`.

## API (v1)

- `POST /api/v1/auth/login` (optional `code` field: 6-digit TOTP or a backup code; with 2FA on and no code the answer is 401 `totp_required`), `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` (includes `totpEnabled`) : dashboard login (session cookie).
- `POST /api/v1/auth/totp/setup`, `/enable`, `/disable` (dashboard session): optional two-step login with an authenticator app. Disabling needs the password and a code. Lost phone and backup codes: `docker compose exec server node src/reset-totp.js <username>`.
- `POST /api/v1/pairing-codes` (dashboard session, optional body `{role: 'sender'|'receiver'}`, default sender) : create a pairing code + QR payload.
- `POST /api/v1/pair` (no auth, code required) : phone exchanges a pairing code for a device token; the answer includes the `role` the code made. A returning phone (same `hardwareId`) that pairs with the other kind of code switches role.
- `DELETE /api/v1/devices/:id` / `PATCH /api/v1/devices/:id` (dashboard session) : revoke / rename a phone.
- `POST /api/v1/messages` : batch of messages from a phone. Bearer token per device. Idempotent on `id`.
- `GET /api/v1/messages?device=&type=&q=&before=` : paginated, newest first.
- `DELETE /api/v1/devices/:id/messages` (dashboard session) : delete one phone's messages; the phone stays paired and keeps sending (no revoke needed).
- `DELETE /api/v1/devices/:id/permanent` (dashboard session) : erase a revoked phone and all its messages (409 if not revoked yet).
- `GET /api/v1/settings` / `PUT /api/v1/settings` (dashboard session) : message retention in days or `null`. Saving deletes older messages at once; the server repeats the purge hourly.
- `GET /api/v1/stream` : live updates (SSE/WebSocket) for viewers.
- `GET /api/v1/devices` : list devices and last-seen, plus `silentAfterMinutes` (the quiet threshold, 0 = off).
- `GET /api/v1/device-stream` (device token, SSE) : the phone's open connection. While it is open the phone is `connected` (in `GET /devices` and in `device_presence` events to dashboards); the server sends `revoked` down it. Presence is in memory (`server/src/presence.js`). One connection per phone; a new one replaces the old. A phone that loses its network never closes the connection and the server cannot tell from its side for many minutes (the 25 s pings only reach a socket buffer), so the app sends `POST /heartbeat` every 25 s while connected (`DeviceStreamClient`), `presence.touch` records it, and a sweep drops connections silent for 60 s (`presence.dropStale`). The dashboard shows "Online" only while `connected`.
- `POST /api/v1/outbox` (dashboard session + CSRF), `GET /api/v1/outbox?device=` (dashboard session): SMS replies typed on the dashboard. A reply is `{deviceId, to, body}`, queued as `queued`, then `sent` or `failed` with a short reason code (`replies_off`, `no_permission`, `no_service`, `expired`, ... never text). The number and text are plain, or `e2e:v1:` text the browser encrypted (fields `reply-to` and `reply-body`, random nonce) when the conversation's own messages were encrypted; the server only size-checks them. A new reply is pushed to the target phone down `device-stream` as an `outbox` event and to dashboards as an `outbox` event.
- `GET /api/v1/outbox/pending` and `POST /api/v1/outbox/:id/result` (device token): the phone fetches its queued replies (also on every reconnect and heartbeat), sends each with `SmsManager` and reports `{status: sent|failed, error?}`. Replies not collected within an hour (`outboxMaxAgeMs`) fail as `expired` instead of going out late. Clearing messages or erasing a phone also removes its replies.
- `PUT /api/v1/sims` (device token): the phone lists its SIMs (`id` = subscription id, `slot` from 1, carrier `name`, never a number, `allowed`). The same body may carry `replies: {on, permission, practice}` (the switch is on, the phone may send texts, practice mode); it is stored with the SIMs in `devices.sims` (now `{sims, replies}`; the older plain array is still read), shown in `GET /devices` as `sims` and `replies` (null until reported), and pushed to dashboards as a `device_sims` event. The dashboard switches the reply box off up front with a reason when replies are off, not permitted, or no SIM is shared or allowed; practice mode skips all of these. The phone also reports whenever the app opens, so a permission changed in Android's settings shows up. When it cannot list its SIMs it reports an empty list. The phone sends it when something changed (a settings change, a new stream connection, the app opening, the 15-minute heartbeat, pairing), not on every call. The dashboard picks the SIM per reply (`sim` on `POST /outbox`, also on the pending list): it starts on the SIM that received the text if the phone allows it, else the only allowed SIM, else the user must choose; SIMs the phone does not allow are shown greyed out. The phone only limits (`allowedSims`, empty until the user ticks one): it fails a reply as `sim_not_allowed`, `sim_missing`, `sim_unknown` or `choose_sim` and never swaps SIM.
- **Receivers** (the main phone, `role = receiver`; its own read-only device token, made from a receiver pairing code; a receiver token cannot `POST /messages`, and a sender token cannot use these): `GET /api/v1/receiver/phones` (the sender phones still paired, `{deviceId, name, battery, lastSeen}`, for the receiver's Status page) and `GET /api/v1/receiver/messages?limit=` (newest first, up to 500, each with the sender phone's `deviceName`, text still encrypted when the sender paired with a key) and `GET /api/v1/receiver/stream` (SSE: `message` (with `deviceName`), `messages_cleared` `{deviceId}`, `messages_cleared_all`, `device_deleted` `{deviceId}`, `messages_purged` (the retention job deleted old ones), and `revoked`). It never carries presence, SIM or reply news. While open the receiver shows as connected on the dashboard, and `POST /heartbeat` keeps it alive like a sender. The retention clean-up now announces itself (`messages_purged`) from both `PUT /settings` and the hourly job.
- `POST /api/v1/unpair` (device token) : the phone unpairs itself; same effect as revoking it in the dashboard, shown there at once.
- `POST /api/v1/heartbeat` (device token) : "this phone is alive". Optional body `{battery: {percent: 0-100, charging: bool}}` (older apps send none; the last known level is kept; an invalid one is 400). Updates last-seen, app version and battery, and open dashboards get a `device_seen` event (with `battery` when sent). `GET /devices` shows `battery: {percent, charging} | null`, and the dashboard's phone list draws it (red at 15% or less while not charging). `server/src/battery.js` watches the levels: 15% or less and not charging announces `device_battery_low` `{deviceId, deviceName, percent}`, plugged in or 20% or more announces `device_battery_ok` (in-memory state, repeated once after a server restart). The phone sends it about every 15 minutes (WorkManager).
- Later: `GET /api/v1/outbox` and `POST /api/v1/outbox` for queued SMS replies.

## Key design rules

- Phones are untrusted clients: authenticate every request with a per-device API key, store only hashes server-side.
- The phone app must never drop a message: write to the local queue first, delete only after the server confirms.
- De-duplicate: the SMS receiver and the notification listener can both fire for one SMS. The phone drops the notification copy by matching text within 2 minutes (the SMS is kept). The server drops a message only if the same content arrives at the same phone timestamp (`dedupe_hash`). A repeat of the same text at a later moment is a new message and must be kept: an earlier minute-bucket rule lost real repeats such as a second code or missed call.
- Treat all content as sensitive (2FA codes, personal messages). No public endpoints without auth, no message bodies in logs.
- Never commit secrets. Use `.env` files with `.env.example` committed.
- Keep the first version small. Get one phone sending one notification end to end before adding features.

## Android compatibility

- Minimum supported device: OnePlus 7T Pro and anything newer. The 7T Pro shipped with Android 10, so `minSdk = 29` (Android 10). Do not use APIs newer than that without a version check.
- `targetSdk` and `compileSdk` set to the current stable level. Test on both ends: the 7T Pro (oldest) and a current Android version.
- Handle behaviour that differs across versions:
  - Android 13+: `POST_NOTIFICATIONS` runtime permission (needed to show the foreground service notification).
  - Android 14+: foreground services must declare a type in the manifest (e.g. `dataSync` or `specialUse`) and the matching permission.
  - Android 12+: restrictions on starting foreground services from the background; start the service from user-visible contexts or boot receivers that are allowed.
  - Android 10+: background activity launch limits and stricter SMS/call-log permission handling.
- Use AndroidX/Jetpack compat libraries instead of raw version checks where possible.

## Android gotchas

- Android tests: Robolectric needs `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED` on JDK 21 (set in `app/build.gradle.kts`), and `robolectric.properties` uses a plain `Application` so WorkManager is not started in unit tests.
- OkHttp 5 needs `compileSdk` 37; `targetSdk` is 37 as well.
- A phone holds an open connection to the server (`GET /api/v1/device-stream`, kept by `DeviceStreamRunner`, reconnects with backoff, and `NetworkWatcher` wakes it the moment Android reports a network, with attempts at least 2 s apart, so a reboot or airplane mode does not leave a minute-long wait). A revoke or unpair in the dashboard is pushed down it at once and the app screen switches to unpaired. If the connection is down (Android deep sleep, no network) the phone finds out at its next heartbeat (about 15 minutes) or message send (a 401). Pings every 25 s keep it alive through nginx (60 s read timeout) and Cloudflare (about 100 s idle).
- With SMS turned off, notifications from the default SMS app are dropped too, because they contain the text of the message. SMS and its notification copy are de-duplicated on the phone by text (2 minute window); the SMS is kept because it has the real number.
- Quick tunnels (`trycloudflare.com`) do not pass Server-Sent Events, so the dashboard's live stream does not work through one. Use a named tunnel.

- Android lets one app have only 50 notifications at a time and silently drops new ones beyond that (logcat: "Package has already posted or enqueued 50 notifications"), so the listener never sees them. An idle phone whose apps pile up unread notifications stops forwarding. The phone setting "Clear notifications after forwarding" (off by default) dismisses a notification once it is safe in the queue (or is a copy of an SMS already forwarded); filtered-out and ongoing ones are never dismissed.
- Notification access is a manual user grant in system settings. The signed app and the dev build (`.debug`) are two apps that can share a phone, and each is a notification listener: `NotificationParser` ignores both packages, otherwise one forwards (and, with "Clear notifications after forwarding", instantly dismisses) the other's alerts, which carry message text and 2FA codes.
- In-app updates (Settings tab, "App updates"): `GitHubReleaseSource` asks `api.github.com/repos/tianyu-00/noti-forwarder/releases/latest` (public repo, no login; drafts and pre-releases are ignored), `AppVersion.isNewer` compares numerically (a `-dev` build is older than its release), `ApkDownloader` fetches the `.apk` asset from GitHub hosts only over https (every redirect hop checked), checks size and GitHub's published sha256, and keeps nothing on failure; `AndroidApkInstaller` streams it into a `PackageInstaller` session and Android shows its own confirmation (`InstallResultReceiver`, `installFailureMessage`). `Updater` is the tested state machine. Needs `REQUEST_INSTALL_PACKAGES` and the user's "install unknown apps" allowance for the app (the button opens that page). **Android only installs an update signed with the same key as the installed app**: until the four signing secrets are set, CI signs with a debug key that differs from a local build's, so updating across them fails with a signature message and needs one uninstall. The install step itself is checked on a phone, not in unit tests.
- Retries: a failed send backs off up to 15 minutes, and `flushSoon()` deliberately ignores a waiting retry so new notifications do not cut a backoff short. When the server is known to be reachable (the app starts, or the live connection opens) `NotiApp.sendWaiting()` calls `queue.retryNow()` (only messages that already failed, never ones held back for the SMS copy rule) and `scheduler.flushNow()`, which replaces a waiting retry but never a running flush. Without this a phone whose server was down for hours stayed silent for up to 15 minutes after it came back. OnePlus's battery manager (`OplusHansManager`) also freezes the app between network packets; WorkManager jobs still run, but late.
- Roles: on first open a new install asks Sender or Receiver (`RoleScreen`, `AppRole`, `effectiveRole`: a phone already paired before roles existed is a sender and is never asked; the choice is in `PrefsRoleStore`; Unpair in Settings forgets the role too, so the phone goes back to that choice; there is no separate "change role" button). Pairing refuses a code made for the other role (`PairOutcome.WrongRole`). A **sender** is everything described elsewhere here. A **receiver** (`ReceiverScreen.kt`) keeps its own copy of the newest 500 messages (`received_messages` table, Room version 4; still encrypted at rest, decrypted only when shown by `MessageReader` with the pairing key), mirrors the dashboard (`SyncPlanner`: a deletion on the dashboard, a retention purge or an erased phone removes the message and its notification; the first sync after pairing is silent, later ones alert for at most the newest 5 missed messages), and shows each new message as a notification (`AlertPlanner`, `AndroidAlertSink`: channels Messages and 2FA codes, a Copy code button, 2FA found by `CodeExtractor`, a Kotlin copy of `server/src/codes.js` with the same test cases). Its rules (alerts on/off, all or only 2FA codes, texts and/or app notifications, apps turned off, built from the apps seen in received notifications) are in `ReceiverSettings`. The connection reuses `DeviceStreamClient`/`DeviceStreamRunner` with `/api/v1/receiver/stream` and an `onEvent` callback; `ReceiverService` is its foreground service (type specialUse). One role per phone at a time. The dev app (`.debug`) can be a receiver while the release app stays a sender, each with its own pairing.
- The app has a bottom bar (`Tabs.kt`): a sender has Status, Forward, Activity, Settings, a receiver has Status, Alerts, Settings; an unpaired phone shows only the pairing screen. Activity lists what was sent, what is waiting and what the server refused, as names and times only. It reads the queue table itself: a confirmed message is kept as a sent row (`sentAt` set, `body` erased, `AutoMigration` 1 to 2) and the newest 50 sent rows are kept (`MessageQueue.keepSent`). Every query that means "still to send" must filter `sentAt IS NULL`. Auto-start has no standard Android page, and on OnePlus the maker's list (`com.oplus.safecenter` StartupAppListActivity, and the battery page `com.oplus.battery` PowerControlActivity) is behind a system permission or not exported, so no app can open it (checked on a 7T Pro). The button opens the app's own info page and `autoStartHelp` just says to turn on auto-launch and allow background activity and that the steps differ on every phone (on some phones it is not in the app's settings at all). On the 7T Pro it is Battery usage, then Allow auto-launch.
- The phone looks up each notification app's real name with `PackageLabels` just before sending (`MessageSender`, not stored in the queue). Android 11+ hides apps that are not declared, so the manifest holds `QUERY_ALL_PACKAGES` (fine because the app is sideloaded; the Play Store restricts it). An app that has been uninstalled has no name; the dashboard shows its package name.
- OnePlus/Oppo kill background apps aggressively: use a foreground service, request battery-optimisation exemption, and document the auto-start settings per device.
- Sideloaded APK, so Play Store SMS-permission policy does not apply.
- Test on the real spare phones (OnePlus 7T Pro first), not just an emulator.

## Development method: TDD

All code is written test-first. No production code without a failing test that demands it.

- Cycle: red (write one failing test, run it, confirm it fails for the right reason) -> green (write the minimum code to pass) -> refactor (clean up with tests green). Commit at green; keep each cycle small.
- Bug fixes start with a failing test that reproduces the bug.
- Do not write tests after the fact to match existing code, and do not edit a test just to make it pass unless the requirement itself changed.
- Test layers:
  - Server (Jest or Vitest + Supertest): unit tests for logic (dedupe hash, validation), API tests for every endpoint (auth, idempotency on retry, pagination, malformed payloads), and integration tests against a real SQLite database (in memory, no Docker needed), including migrations.
  - Web (Vitest + React Testing Library): test behaviour the user sees, not implementation. Mock the API with MSW. Test live-update handling and filtering.
  - Android (JUnit + Robolectric/MockK for unit tests): the queue and retry logic, the dedupe logic, payload mapping and the notification-to-message parsing are all pure logic and must be unit tested. Use an in-memory Room database for queue tests. Keep Android framework classes behind thin wrappers so the logic can be tested on the JVM. Instrumented tests (Espresso/AndroidX Test) for the listener service and permissions flow, run on the 7T Pro or an emulator.
  - End to end: one test that sends a message through the real API and sees it in the dashboard, run in CI against the Compose stack.
- CI gate: the pipeline runs lint and all tests before building images. If tests fail, nothing is published, even on a branch push.
- Coverage is a guide, not a target. Business logic (dedupe, queue, auth) must be fully covered.
- When asked to build a feature, first propose the list of test cases, then proceed one failing test at a time.

## Build, deploy and versioning

Current setup (decided during Milestone 0; the earlier plan for release-please, SSH deploy and semver release tags was dropped for now).

- Images are built by CI, never by hand on the server.
- CI (`.github/workflows/ci.yml`): every push and PR runs lint and tests for `server` and `web` (plus the web build). Images are built and published to GitHub Container Registry (`ghcr.io/<owner>/notiforwarder-server`, `...-web`) **only when pushing to the `publish` branch**, and only after all test jobs pass. To release: `git push origin main:publish`.
- Image tags: the short commit SHA (`sha-abc1234`) and `latest` (always the newest published build). There is no `edge` or semver tag yet. The old `publish` image tag is gone; the `publish` branch is still the release trigger.
- Builds target `linux/amd64` and `linux/arm64` until the Ubuntu host's architecture is confirmed (`uname -m` on the server); narrow it then.
- Deploy is manual: on the Ubuntu server set `VERSION` in `.env` to an explicit tag (a SHA tag, or `latest` for the newest) and run `docker compose pull && docker compose up -d`. Roll back by changing `VERSION`. See `deploy/README.md`. A push publishing an image does not by itself change what is running.
- `deploy/docker-compose.yml` is the one compose file: images by `${VERSION:-latest}`, only `PUBLIC_URL` and `ADMIN_PASSWORD` required, the rest defaulted (see `deploy/.env.example`), data in the `notiforwarder-data` volume. The `web` container (nginx) is the single public entry point on port 3000 (`WEB_BIND` to restrict it); it serves the dashboard and proxies `/api` to the server, which is not published. Point the Cloudflare tunnel at it. Phones use the same public address.
- Set `TRUST_PROXY` to the number of reverse-proxy hops in front of the server (2 = cloudflared + the web container) so per-IP rate limits see the real client address.
- The compose file does not include a tunnel or proxy (HTTPS is the user's own setup); it runs only `web` and `server`. There is no database to set up. See `deploy/README.md`.
- Every component reports its version: `GET /api/v1/health` returns `{ version, commit, buildTime }`, and the web dashboard shows the web and server versions in its footer. They are passed in as Docker build args (`APP_VERSION`, `GIT_COMMIT`, `BUILD_TIME`).
- Versions: the `VERSION` file at the repo root holds `MAJOR.MINOR` (edit it by hand to bump). CI appends the workflow run number, giving `0.1.<run>`, and uses it for the server and web images (`APP_VERSION`), the Android `versionName`, and a GitHub Release tag `v0.1.<run>`. The Android `versionCode` is the run number, so it always rises. Local builds use `0.1.0-dev`, code 1.\n- Android release: on a push to `publish`, the `release-android` job builds a signed release APK and attaches it to that GitHub Release (sideload it). It signs with a keystore from the GitHub secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`; without them it falls back to the debug key with a warning, and a phone then cannot update the app in place. Never commit a keystore (`*.jks` is ignored). Not decided yet: changelog automation.
- API compatibility: the API is versioned in the URL (`/api/v1`). Old phones must keep working after a server update, so never make a breaking change to `v1`. Add `v2` instead and support both until the phones are updated. The server records the phone app's version from each request (`X-App-Version` header).
- Database: schema changes go through numbered SQL migrations in `server/migrations/` that run automatically on server start. Migrations must be backward compatible with the previous release so a rollback is safe.
- SQLite rules (`server/src/db/sqlite.js`): the server keeps the Postgres-pool shape (`db.query(sql, [params])` with `$1` placeholders giving `{ rows, rowCount }`) on ONE connection. (1) Use `db.transaction(async (client) => ...)` for transactions and use the `client` inside it, never `db.query`: other queries wait for the connection the transaction holds, so mixing them deadlocks. (2) Times are UTC text `2026-11-11T10:00:05.123Z` (sorts in time order); columns named `*_at`, `*_until` or `last_seen` come back as `Date`, anything else is never converted (so a message body that looks like a time stays text). Pass `Date`s in, and use `ts_add_ms(now(), ms)` for expiries; `now()` and `gen_random_uuid()` are registered SQL functions. (3) Ids are stored lower case. (4) `LIKE` ignores case only for plain letters. (5) The first release on SQLite reset the migrations to a single baseline `001_initial.sql`; keep adding numbered, additive files after it. (6) The data folder must be on a local disk, not NFS/SMB. (7) Backups use `node src/backup.js` (`VACUUM INTO`), never a copy of the live file.

## Milestones

Status as of the last update: 0, 1, 1b, 2, 3, 4 and 5 are done, 6 and 7 are built and tested (the receiver app is built and tried on a phone with a local server but not yet on the real server; the SIM picker, the dashboard SIM dropdown and practice mode are tested in code but not tried on the phone, and a real reply send has never been tested on purpose). 3's reboot survival is verified on a real phone; the OnePlus battery/auto-start settings still depend on the user toggling them.

0. Pipeline first: CI runs lint and tests, then builds and publishes images from the `publish` branch, compose file, `/health` showing the version. (done; release-please and SSH deploy dropped)
1. Server: Express + Postgres, `POST /messages`, `GET /messages`, Docker Compose. (done)
   1b. Auth and pairing: web login, pairing code + QR, `/pair` endpoint, device tokens, revoke. (done)
2. Android: pair with the server (QR/key), then notification listener that POSTs one notification to the server. (done; re-pairing the same phone reuses its entry via `hardware_id`)
3. Reliability: Room queue, retry with backoff, foreground service, survives reboot. (done and verified on a real phone: offline then online, and a reboot — the listener rebinds and the boot receiver starts the keep-alive service by itself)
4. SMS capture + de-duplication, plus phone settings: SMS/notification toggles and the app blacklist. (done and verified on a real phone: texts arrive once, the toggles and blocked apps work. A notification from the SMS app is stored at once with a 3s "not before" time and removed when its SMS arrives, so nothing is held only in memory)
5. React dashboard (Tailwind + Radix UI) with live updates, search, per-device filter. (done; unread counts are client-side only and reset on reload)
6. Alerts on the main phone: the receiver app (see Roles) shows each message as a notification with its 2FA code and a Copy code button, and keeps its history in step with the dashboard. The server detects the 2FA code and adds a `code` field to plain messages and the dashboard highlights it with a copy button. A sender phone that stops checking in is announced to receivers: `server/src/silent.js` (checks every 5 minutes, in-memory "already announced" set, `SILENT_AFTER_MINUTES`, default 120, 0 = off) publishes `device_quiet` `{deviceId, deviceName, minutes}` and `device_back` `{deviceId, deviceName}` on the event hub (battery news, `device_battery_low` and `device_battery_ok`, travels the same way; `BatteryPlanner`, switch "Low battery", the "ok" news just removes the notice), the receiver stream forwards them (names only, never text), and the app shows one notice per phone (`QuietPlanner`, channel "Phone status", "is back" replaces "has gone quiet"; switch "Quiet phones" in Alert settings, default on). Only receivers connected at that moment are told; a quiet phone also shows on the dashboard from the same setting. There is no other server-side push.
7. SMS reply from the PC (built and tested: outbox table (migration 002), dashboard reply box and live status, phone side `OutboxClient`, `ReplyProcessor`, `ReplyLedger` (a reply is never sent twice), `AndroidSmsSender`; off until the user turns on "Reply from the dashboard" in the app's Forward tab, which asks for `SEND_SMS`. **Practice mode** lives in the app's Settings tab, in the Developer mode card, which appears after tapping the Version row (App updates card) 7 times (`DeveloperTaps`; the Developer mode switch in the same card turns it off again, and turning developer mode off also turns practice off, `withDeveloperMode`). It receives, decrypts and checks replies exactly as usual but never sends, and reports `practice`; it overrides every other setting, including on the dashboard, whose reply box then ignores the replies-off and SIM blocks. **SIMs**: the dashboard chooses the SIM per reply (see `PUT /sims`); the phone only limits them. Forward tab: "SIMs allowed for replies" (`READ_PHONE_STATE` only to list SIMs; nothing is allowed until the user ticks one). A reply naming a SIM that is gone fails (`sim_missing`), one not allowed fails (`sim_not_allowed`), unreadable SIMs fail (`sim_unknown`), and a reply naming none goes out only when exactly one SIM is allowed (else `choose_sim`); the phone never swaps SIM. When Android stops showing a permission dialog (refused twice) the button opens the app's permission page instead (`nextAskStep`). Never send a real SMS while testing: use practice mode or the automated tests, and a live send only when the user explicitly asks).
Hardening (done): the phone API is rate limited per IP before the token check; a login lock that has expired starts counting from zero; a revoked phone can be erased with its messages; message retention is a dashboard setting with an hourly purge; an end-to-end test (`e2e/`) runs against the real stack in CI (API level, no browser).
TOTP two-step login is built (optional; turned on in the dashboard Settings; `otpauth` library; with `SECRET_KEY` set (32+ characters) the secret is encrypted in the database with AES-256-GCM (`server/src/auth/secret-box.js`), existing plain secrets are sealed at the next start, and the server refuses to start if sealed secrets exist but the key is missing or wrong; without `SECRET_KEY` it is stored in plain text, so protect database backups). A browser-level end-to-end test (Playwright, `e2e/dashboard.spec.js`) covers login, Add phone, a live message with its code, search and sign out; CI runs it in `test-e2e`.

## Working conventions

- Small commits, one logical change each, written as Conventional Commits (they drive the version bump); run tests/linters before committing.
- Follow TDD (see Development method). Tests come first, in every component.
- Ask before adding new dependencies or changing the data model.
- Do not add `Co-Authored-By` (or any Claude attribution) lines to commits or PR descriptions.
- Explain Android-specific decisions briefly; I'm more experienced with web/Node than native Android.

## Commands

- Server dev: `cd server && npm run dev` (needs `PUBLIC_URL`; the database is `./data/notiforwarder.db` unless `DATABASE_PATH` is set; see `.env.example`)
- Server tests: `cd server && npm test` (watch mode: `npm run test:watch`). No Docker needed: each test file gets its own in-memory SQLite database.
- Server lint: `cd server && npm run lint`
- Web dev: `cd web && npm run dev` (proxies `/api` to `localhost:3000`)
- Web tests: `cd web && npm test`; lint: `npm run lint`; build: `npm run build`
- Stack up (on the server): `cd deploy && docker compose up -d` after copying `.env.example` to `.env` (see `deploy/README.md`)
- End-to-end test (own throwaway stack on port 3100): `docker compose -p notiforwarder-e2e -f e2e/docker-compose.yml up -d --build && node e2e/run.mjs`, then the browser test `cd e2e && npm ci && npx playwright install chromium && npx playwright test` (Playwright, `e2e/dashboard.spec.js`; `E2E_BASE_URL` overrides the address), then `docker compose -p notiforwarder-e2e -f e2e/docker-compose.yml down -v`. CI runs it as `test-e2e` before publishing.
- Release images: `git push origin main:publish`
- Android unit tests: `cd android && ./gradlew testDebugUnitTest` (needs `JAVA_HOME`/`ANDROID_HOME`; JDK 21 and the SDK are under `~/android-dev`)
- Android lint + build: `cd android && ./gradlew lintDebug assembleDebug` (APK at `app/build/outputs/apk/debug/`; CI also uploads it as an artifact)
- Install on a phone: `adb install -r app/build/outputs/apk/debug/app-debug.apk` (wireless debugging: `adb pair` once, then `adb connect <ip:port>`)
- Two apps on one phone: a debug build from this PC is its own app, `com.notiforwarder.sender.debug`, named "Notiforwarder dev" (`applicationIdSuffix` and a manifest label placeholder in `android/app/build.gradle.kts`), so it installs next to the signed release app (`com.notiforwarder.sender`) with no signature clash and no uninstall. Each has its own pairing, permissions and settings, so give each its own server (a local stack for the dev app) or the same messages are sent twice. The release app is not debuggable, so `adb shell run-as` works only for `com.notiforwarder.sender.debug`. The dev app hides the update check, because a release APK cannot update an app with a different id.

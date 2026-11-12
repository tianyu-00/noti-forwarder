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

- HTTPS only. Redirect HTTP, enable HSTS. The Android app refuses cleartext traffic (`usesCleartextTraffic=false`).
- Web login required: single-user to start. Password hashed with argon2 (or bcrypt), httpOnly + Secure + SameSite session cookie, login rate limiting and lockout, CSRF protection. TOTP 2FA as a follow-up.
- Device tokens: long random, hashed at rest, per device, revocable, never logged. Pairing codes are single-use and short-lived.
- Rate limiting and request size limits on every endpoint; strict input validation (schema validation on all payloads); Helmet security headers; CORS restricted to the dashboard origin.
- Render notification/SMS text as plain text only. Never use `dangerouslySetInnerHTML`; treat all message content as untrusted input (XSS).
- No message bodies in logs. Audit log for pairings, revocations and logins.
- Optional hardening later: Cloudflare Access in front of the dashboard (leaving the phone API path open), certificate pinning in the app, end-to-end encryption of message bodies so the server stores only ciphertext.

## Architecture

```
[Source phones: OnePlus 7T Pro]
  Kotlin app (NotificationListenerService + SMS receiver)
  -> local queue (Room) -> HTTPS POST (retry)
                |
                v
[Ubuntu server, Docker Compose]
  api (Node.js/Express) -> Postgres
  -> WebSocket/SSE push to viewers
  -> optional publish to ntfy for real push alerts
                |
                v
[Viewers] React dashboard (PWA) on PC + main Android phone
```

## Repo layout (monorepo)

```
/android     Kotlin Android app (sender)
/server      Node.js API + Postgres migrations
/web         React dashboard (PWA)
/deploy      docker-compose.yml, env examples
```

## Tech stack

- Android: Kotlin, `NotificationListenerService`, `BroadcastReceiver` for `SMS_RECEIVED`, foreground service, Room for the offline queue, OkHttp/Retrofit.
- Server: Node.js (Express), Postgres, WebSocket or SSE, Docker Compose.
- Web: React + Tailwind CSS + Radix UI (primitives, styled with Tailwind; shadcn/ui-style composition is fine). Built as a PWA (installable on the phone). Use Vite for the build. Plain JavaScript (JSX), no TypeScript; use ESLint and prop validation where helpful.
- Deployment: Ubuntu server running Docker Compose, Cloudflare tunnel in front, Nginx Proxy Manager where applicable. Confirm the host CPU architecture (amd64 vs arm64) before pinning images.

## Data model

Table `messages`:

- `id` (uuid, generated by the phone so retries are idempotent)
- `device_id` (text, which phone sent it)
- `type` (`sms` | `notification`)
- `app` (package name, or `sms`)
- `sender` / `title`
- `body`
- `received_at` (timestamptz, from the phone)
- `created_at` (timestamptz, server)
- `dedupe_hash` (hash of device + app + sender + body + the phone's exact timestamp to the millisecond; so only the same notification delivered twice is dropped, and the same text arriving later is kept)

Table `devices`: `device_id`, `name`, `model`, `app_version`, `token_hash`, `paired_at`, `last_seen`, `revoked_at`.

Table `pairing_codes`: `code_hash`, `created_at`, `expires_at`, `used_at`, `device_id` (set when used).

Table `users`: `id`, `username`, `password_hash`, `totp_secret` (set while 2FA setup is pending and once on), `totp_enabled_at`, `totp_last_step` (replay guard), `failed_logins`, `locked_until`. Table `totp_backup_codes`: `code_hash`, `user_id`, `used_at` (10 one-use recovery codes, hashed). Sessions stored server-side or as signed cookies.

Table `settings`: `key`, `value` (jsonb), `updated_at`. Holds dashboard settings; today only `retention_days` (absent = keep messages forever).

Table `audit_log`: `id`, `event` (login, pair, revoke, ...), `actor`, `device_id`, `ip`, `created_at`.

## API (v1)

- `POST /api/v1/auth/login` (optional `code` field: 6-digit TOTP or a backup code; with 2FA on and no code the answer is 401 `totp_required`), `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` (includes `totpEnabled`) : dashboard login (session cookie).
- `POST /api/v1/auth/totp/setup`, `/enable`, `/disable` (dashboard session): optional two-step login with an authenticator app. Disabling needs the password and a code. Lost phone and backup codes: `docker compose exec server node src/reset-totp.js <username>`.
- `POST /api/v1/pairing-codes` (dashboard session) : create a pairing code + QR payload.
- `POST /api/v1/pair` (no auth, code required) : phone exchanges a pairing code for a device token.
- `DELETE /api/v1/devices/:id` / `PATCH /api/v1/devices/:id` (dashboard session) : revoke / rename a phone.
- `POST /api/v1/messages` : batch of messages from a phone. Bearer token per device. Idempotent on `id`.
- `GET /api/v1/messages?device=&type=&q=&before=` : paginated, newest first.
- `DELETE /api/v1/devices/:id/permanent` (dashboard session) : erase a revoked phone and all its messages (409 if not revoked yet).
- `GET /api/v1/settings` / `PUT /api/v1/settings` (dashboard session) : message retention in days or `null`. Saving deletes older messages at once; the server repeats the purge hourly.
- `GET /api/v1/stream` : live updates (SSE/WebSocket) for viewers.
- `GET /api/v1/devices` : list devices and last-seen.
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
- The phone can only find out it was revoked when it next tries to send (a 401), not before.
- With SMS turned off, notifications from the default SMS app are dropped too, because they contain the text of the message. SMS and its notification copy are de-duplicated on the phone by text (2 minute window); the SMS is kept because it has the real number.
- Quick tunnels (`trycloudflare.com`) do not pass Server-Sent Events, so the dashboard's live stream does not work through one. Use a named tunnel.

- Android lets one app have only 50 notifications at a time and silently drops new ones beyond that (logcat: "Package has already posted or enqueued 50 notifications"), so the listener never sees them. An idle phone whose apps pile up unread notifications stops forwarding. The phone setting "Clear notifications after forwarding" (off by default) dismisses a notification once it is safe in the queue (or is a copy of an SMS already forwarded); filtered-out and ongoing ones are never dismissed.
- Notification access is a manual user grant in system settings.
- OnePlus/Oppo kill background apps aggressively: use a foreground service, request battery-optimisation exemption, and document the auto-start settings per device.
- Sideloaded APK, so Play Store SMS-permission policy does not apply.
- Test on the real spare phones (OnePlus 7T Pro first), not just an emulator.

## Development method: TDD

All code is written test-first. No production code without a failing test that demands it.

- Cycle: red (write one failing test, run it, confirm it fails for the right reason) -> green (write the minimum code to pass) -> refactor (clean up with tests green). Commit at green; keep each cycle small.
- Bug fixes start with a failing test that reproduces the bug.
- Do not write tests after the fact to match existing code, and do not edit a test just to make it pass unless the requirement itself changed.
- Test layers:
  - Server (Jest or Vitest + Supertest): unit tests for logic (dedupe hash, validation), API tests for every endpoint (auth, idempotency on retry, pagination, malformed payloads), and integration tests against a real Postgres (Testcontainers or a Compose test service), including migrations.
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
- Image tags: the short commit SHA (`sha-abc1234`) and `publish` (always the newest published build). There is no `latest`, `edge` or semver tag yet.
- Builds target `linux/amd64` and `linux/arm64` until the Ubuntu host's architecture is confirmed (`uname -m` on the server); narrow it then.
- Deploy is manual: on the Ubuntu server set `VERSION` in `.env` to an explicit tag (a SHA tag, or `publish` for the newest) and run `docker compose pull && docker compose up -d`. Roll back by changing `VERSION`. See `deploy/README.md`. A push publishing an image does not by itself change what is running.
- `deploy/docker-compose.yml` references images by `${VERSION}`, never only `latest`. The `web` container (nginx) is the single public entry point on `127.0.0.1:3000`; it serves the dashboard and proxies `/api` to the server, which is not published. Point the Cloudflare tunnel at it. Phones use the same public address.
- Set `TRUST_PROXY` to the number of reverse-proxy hops in front of the server (2 = cloudflared + the web container) so per-IP rate limits see the real client address.
- Every component reports its version: `GET /api/v1/health` returns `{ version, commit, buildTime }`, and the web dashboard shows the web and server versions in its footer. They are passed in as Docker build args (`APP_VERSION`, `GIT_COMMIT`, `BUILD_TIME`).
- Not decided yet: release tags / Semantic Versioning / changelog automation, and Android `versionName`/`versionCode` and APK publishing. Revisit when the Android app exists.
- API compatibility: the API is versioned in the URL (`/api/v1`). Old phones must keep working after a server update, so never make a breaking change to `v1`. Add `v2` instead and support both until the phones are updated. The server records the phone app's version from each request (`X-App-Version` header).
- Database: schema changes go through numbered SQL migrations in `server/migrations/` that run automatically on server start. Migrations must be backward compatible with the previous release so a rollback is safe.

## Milestones

Status as of the last update: 0, 1, 1b, 2, 3, 4 and 5 are done, and 6 is built and tested (its ntfy push still needs enabling and a check on the real phone). 3's reboot survival is verified on a real phone; the OnePlus battery/auto-start settings still depend on the user toggling them. 7 is not started.

0. Pipeline first: CI runs lint and tests, then builds and publishes images from the `publish` branch, compose file, `/health` showing the version. (done; release-please and SSH deploy dropped)
1. Server: Express + Postgres, `POST /messages`, `GET /messages`, Docker Compose. (done)
   1b. Auth and pairing: web login, pairing code + QR, `/pair` endpoint, device tokens, revoke. (done)
2. Android: pair with the server (QR/key), then notification listener that POSTs one notification to the server. (done; re-pairing the same phone reuses its entry via `hardware_id`)
3. Reliability: Room queue, retry with backoff, foreground service, survives reboot. (done and verified on a real phone: offline then online, and a reboot — the listener rebinds and the boot receiver starts the keep-alive service by itself)
4. SMS capture + de-duplication, plus phone settings: SMS/notification toggles and the app blacklist. (done and verified on a real phone: texts arrive once, the toggles and blocked apps work. A notification from the SMS app is stored at once with a 3s "not before" time and removed when its SMS arrives, so nothing is held only in memory)
5. React dashboard (Tailwind + Radix UI) with live updates, search, per-device filter. (done; unread counts are client-side only and reset on reload)
6. ntfy push to the main phone; filters and 2FA code highlighting. (built and tested: the server detects the 2FA code and adds a `code` field to messages, the dashboard highlights it with a copy button, and ntfy push is configured by `NTFY_*` environment variables with mode/type/app filters, JSON publishing, a burst cap and no message text in logs. Filters are env-only; a dashboard settings screen would need a stored setting. The public ntfy.sh needs a long random topic; the server refuses a short one.)
7. SMS reply from the PC (outbox polled by the phone, sent via `SmsManager`).
Hardening (done): the phone API is rate limited per IP before the token check; a login lock that has expired starts counting from zero; a revoked phone can be erased with its messages; message retention is a dashboard setting with an hourly purge; an end-to-end test (`e2e/`) runs against the real stack in CI (API level, no browser).
TOTP two-step login is built (optional; turned on in the dashboard Settings; `otpauth` library; the secret is stored unencrypted in the database like the session data, so protect database backups). Still open: a browser-level end-to-end test (would need Playwright).

## Working conventions

- Small commits, one logical change each, written as Conventional Commits (they drive the version bump); run tests/linters before committing.
- Follow TDD (see Development method). Tests come first, in every component.
- Ask before adding new dependencies or changing the data model.
- Do not add `Co-Authored-By` (or any Claude attribution) lines to commits or PR descriptions.
- Explain Android-specific decisions briefly; I'm more experienced with web/Node than native Android.

## Commands

- Server dev: `cd server && npm run dev` (needs `DATABASE_URL` and `PUBLIC_URL`; see `.env.example`)
- Server tests: `cd server && npm test` (watch mode: `npm run test:watch`). Needs Docker running: integration tests start a real Postgres with Testcontainers.
- Server lint: `cd server && npm run lint`
- Web dev: `cd web && npm run dev` (proxies `/api` to `localhost:3000`)
- Web tests: `cd web && npm test`; lint: `npm run lint`; build: `npm run build`
- Stack up (on the server): `cd deploy && docker compose up -d` after copying `.env.example` to `.env` (see `deploy/README.md`)
- End-to-end test (own throwaway stack on port 3100): `docker compose -p notiforwarder-e2e -f e2e/docker-compose.yml up -d --build && node e2e/run.mjs`, then `docker compose -p notiforwarder-e2e -f e2e/docker-compose.yml down -v`. CI runs it as `test-e2e` before publishing.
- Release images: `git push origin main:publish`
- Android unit tests: `cd android && ./gradlew testDebugUnitTest` (needs `JAVA_HOME`/`ANDROID_HOME`; JDK 21 and the SDK are under `~/android-dev`)
- Android lint + build: `cd android && ./gradlew lintDebug assembleDebug` (APK at `app/build/outputs/apk/debug/`; CI also uploads it as an artifact)
- Install on a phone: `adb install -r app/build/outputs/apk/debug/app-debug.apk` (wireless debugging: `adb pair` once, then `adb connect <ip:port>`)

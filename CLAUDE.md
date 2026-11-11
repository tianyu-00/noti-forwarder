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
- `dedupe_hash` (hash of device + app + sender + body + minute bucket)

Table `devices`: `device_id`, `name`, `model`, `app_version`, `token_hash`, `paired_at`, `last_seen`, `revoked_at`.

Table `pairing_codes`: `code_hash`, `created_at`, `expires_at`, `used_at`, `device_id` (set when used).

Table `users`: `id`, `email`/`username`, `password_hash`, `totp_secret` (later). Sessions stored server-side or as signed cookies.

Table `audit_log`: `id`, `event` (login, pair, revoke, ...), `actor`, `device_id`, `ip`, `created_at`.

## API (v1)

- `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me` : dashboard login (session cookie).
- `POST /api/v1/pairing-codes` (dashboard session) : create a pairing code + QR payload.
- `POST /api/v1/pair` (no auth, code required) : phone exchanges a pairing code for a device token.
- `DELETE /api/v1/devices/:id` / `PATCH /api/v1/devices/:id` (dashboard session) : revoke / rename a phone.
- `POST /api/v1/messages` : batch of messages from a phone. Bearer token per device. Idempotent on `id`.
- `GET /api/v1/messages?device=&type=&q=&before=` : paginated, newest first.
- `GET /api/v1/stream` : live updates (SSE/WebSocket) for viewers.
- `GET /api/v1/devices` : list devices and last-seen.
- Later: `GET /api/v1/outbox` and `POST /api/v1/outbox` for queued SMS replies.

## Key design rules

- Phones are untrusted clients: authenticate every request with a per-device API key, store only hashes server-side.
- The phone app must never drop a message: write to the local queue first, delete only after the server confirms.
- De-duplicate: the SMS receiver and the notification listener can both fire for one SMS. Drop repeats using `dedupe_hash`.
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

- Images are built automatically on deploy. Nothing is built by hand on the server.
- CI: GitHub Actions builds Docker images for `server` and `web` on every push (any branch, and version tags) and publishes them to GitHub Container Registry (`ghcr.io/<owner>/notiforwarder-server`, `...-web`). Use `docker buildx` with layer caching. Build for the target architecture of the Ubuntu host.
- Deploy: the Ubuntu server pulls the new images and restarts via `docker compose pull && docker compose up -d`. Triggered by CI over SSH, or by a pull-based updater (e.g. Watchtower) watching the registry. Pick one and document it in `/deploy`.
- `deploy/docker-compose.yml` references images by explicit version tag (`${VERSION}`), never only `latest`, so any deploy can be rolled back by changing one variable.
- Versioning: Semantic Versioning (`MAJOR.MINOR.PATCH`) for the whole repo, driven by git tags (`v1.2.3`) and Conventional Commits (`feat:`, `fix:`, `feat!:`). Use release-please or semantic-release to bump the version, update `CHANGELOG.md` and create the tag.
- Image tags: every push is published with the short commit SHA and the sanitised branch name (e.g. `feat-sms-capture`). Pushes to `main` also get `edge`. Release tags get `1.2.3`, `1.2`, `1` and `latest`. Because every push publishes, `latest` and the semver tags must only ever come from release tags, never from a branch push.
- Deploy picks an explicit tag (a release version, or a SHA/branch tag for testing a branch on the server); a push publishing an image does not by itself change what is running in production.
- Every component reports its version: `GET /api/v1/health` returns `{ version, commit, buildTime }`, and the web dashboard shows the version in its footer. Pass these in as Docker build args.
- Android app: `versionName` follows the repo version. `versionCode` is an integer that increases every release (derive it from the CI run number or from the version). CI builds a signed release APK and attaches it to the GitHub release.
- API compatibility: the API is versioned in the URL (`/api/v1`). Old phones must keep working after a server update, so never make a breaking change to `v1`. Add `v2` instead and support both until the phones are updated. The server should accept and record the phone app's version in each request (`X-App-Version` header).
- Database: schema changes go through numbered migrations that run automatically on server start. Migrations must be backward compatible with the previous release so a rollback is safe.

## Milestones

0. Pipeline first: GitHub Actions runs lint and tests, then builds and publishes images, release-please versioning, compose deploy to the Ubuntu server, `/health` showing the version (itself built test-first).
1. Server: Express + Postgres, `POST /messages`, `GET /messages`, Docker Compose, running on the Ubuntu server.
   1b. Auth and pairing: web login, pairing code + QR, `/pair` endpoint, device tokens, revoke.
2. Android: pair with the server (QR/key), then notification listener that POSTs one notification to the server.
3. Reliability: Room queue, retry with backoff, foreground service, survives reboot.
4. SMS capture + de-duplication, plus phone settings: SMS/notification toggles and the app blacklist.
5. React dashboard (Tailwind + Radix UI) with live updates, search, per-device filter.
6. ntfy push to the main phone; filters and 2FA code highlighting.
7. SMS reply from the PC (outbox polled by the phone, sent via `SmsManager`).

## Working conventions

- Small commits, one logical change each, written as Conventional Commits (they drive the version bump); run tests/linters before committing.
- Follow TDD (see Development method). Tests come first, in every component.
- Ask before adding new dependencies or changing the data model.
- Explain Android-specific decisions briefly; I'm more experienced with web/Node than native Android.

## Commands

(Fill in as the project takes shape.)

- Server dev: `cd server && npm run dev`
- Server tests: `cd server && npm test` (watch mode: `npm run test:watch`)
- Web tests: `cd web && npm test`
- Android unit tests: `cd android && ./gradlew test`
- Stack up: `docker compose -f deploy/docker-compose.yml up -d`
- Web dev: `cd web && npm run dev`
- Android build: `cd android && ./gradlew assembleDebug`

# RanjanSoft on Next.js: encrypted contact messages and an admin app

Date: 2026-10-12
Status: approved design, awaiting spec review

## 1. Goal

Rebuild the RanjanSoft website as Next.js so the public pages and the contact API live in one codebase. Store every contact submission encrypted, so the database alone never reveals a message. Add a separate admin app where only the owner can sign in and read all messages.

Success means:

- A visitor on the GitHub Pages site sends the contact form, and the record in MongoDB is unreadable without the admin's private key.
- The owner signs in to the admin app with Google (hr.ranjansoft@gmail.com) and sees every message, decrypted, newest first.
- Anyone else is refused, and the admin app is not reachable from the public internet.
- The public site looks and behaves as it does today: same design, both themes, all screen sizes.

## 2. Decisions

| Topic | Decision |
|---|---|
| Public pages | Next.js static export, deployed to GitHub Pages by GitHub Actions |
| Contact API | Route handler in the same Next.js app (`apps/web`), run as a container on stock-market-server and made public with Tailscale Funnel |
| Database | Existing MongoDB on `stock-market-server.beetal-sun.ts.net:27017` (tailnet only, not exposed), database `ranjansoft` |
| Encryption | Hybrid: per-message AES-256-GCM key, wrapped with X25519. The API holds only the public key; only the admin app holds the private key |
| Admin app | Separate Next.js app (`apps/admin`), container on stock-market-server, HTTPS on the tailnet only via `tailscale serve` |
| Admin login | Google sign-in (Auth.js), allow-list containing only hr.ranjansoft@gmail.com |
| Repo | npm workspaces monorepo, TypeScript |
| Page URLs | Real paths (`/about`, `/services`, `/projects`, `/contact`) with client-side navigation; old `/#name` links redirect |

## 3. Repository layout

```
apps/web/         Next.js: public pages + /api/contact route handler
apps/admin/       Next.js: Google sign-in + message list
packages/core/    shared TypeScript: service list, form validation, encryption, MongoDB access
.github/workflows/ci.yml
podman-compose.yml   web-api + admin containers for stock-market-server
```

The current `index.html`, `api/`, `site.conf`, `Dockerfile` and `.github/workflows/deploy.yml` are removed once `apps/web` reaches parity. No Turborepo or other build tool; plain npm workspaces.

## 4. Public site (`apps/web`)

### Pages and styling

- Each current page (`#page-home`, `about`, `services`, `projects`, `contact`) becomes an App Router route, with shared `Nav` and `Footer` in the root layout.
- The existing `<style>` block moves to `app/globals.css` unchanged. Design tokens, the light/dark themes, the Archivo font and the responsive breakpoints keep working exactly as they do now.
- The inline theme script stays in `<head>` so the theme is set before paint (`localStorage['rs-theme']`, falling back to `prefers-color-scheme`).
- Interactive pieces become small client components: theme toggle, mobile menu, project filter and counts, tech-stack tabs, counters and the contact form. Everything else is a server component, rendered to static HTML at build time.
- A client-side redirect on `/` turns legacy `/#about` style links into `/about`.
- The hero schematic keeps Networks and Servers & hosting hidden, as today.

### Two build targets from one app

`apps/web/next.config.ts` reads `BUILD_TARGET`:

- **`pages`**: `output: 'export'` and `basePath` from `PAGES_BASE_PATH` (`/ranjansoft` while the site lives at `ibrijeshsoni.github.io/ranjansoft/`, empty after a move to `ranjansoft.github.io`). Route handlers are left out of this build. They are named `route.api.ts`, and `pageExtensions` only includes `api.ts` for the server build. `NEXT_PUBLIC_CONTACT_API_URL` is baked in as the form's endpoint.
- **`server`**: `output: 'standalone'`, used for the container. It serves the API, and the pages too, which is handy for local testing. With `NEXT_PUBLIC_CONTACT_API_URL` empty, the form posts to the same origin.

### `POST /api/contact`

1. **CORS:** allow only the origins in `ALLOWED_ORIGINS` (default: the GitHub Pages origins). Answer `OPTIONS` preflights.
2. **Parse:** request bodies are limited to 20 KB. Malformed JSON returns `400 {ok:false,error}`.
3. **Honeypot:** if the hidden `website` field is filled, return `201` without saving anything.
4. **Validate** with `packages/core` (same rules as today):
   - required: first name, email, service and message
   - maximum lengths: 80 / 80 / 254 / 160 / 80 / 5000
   - line breaks are stripped from single-line fields
   - the service must be in `SERVICES`

   Failures return `400 {ok:false,errors:{field:msg}}`.
5. **Rate limit** using a MongoDB collection `rate_limits`, keyed by HMAC-SHA256 of a key, with a TTL index:
   - 3 per sender email per 10 minutes
   - 10 per client IP per hour
   - 60 per hour overall

   Behind Funnel, the client IP comes from `X-Forwarded-For`; when it is absent, the per-IP limit is skipped. Exceeding a limit returns `429 {ok:false,error}`.
6. **Encrypt and insert** into `contact_submissions` (see §5). If the database fails, return `500` with "email us at hr.ranjansoft@gmail.com instead".
7. **Notify:** send an email to `MAIL_TO` through SMTP with no message content ("New enquiry received at <time>. Open the admin app to read it."). It is skipped when `SMTP_HOST` is empty, and a failure is logged but never fails the request.
8. Respond `201 {ok:true}`.

`GET /api/health` returns `{ok:true}` once MongoDB is connected.

### Contact form behaviour

The form keeps today's behaviour:

- client-side checks
- an error message under each field, with `aria-invalid` set
- "Sending…" and a disabled button while the request is in flight
- a success message, then the form is reset
- on failure, an error message that suggests emailing instead, with the visitor's input kept

## 5. Encryption (`packages/core/crypto`)

Built on Node's built-in `crypto` only.

- **Keys:** an X25519 key pair is generated once with `npm run keygen -w packages/core`, which prints both keys as base64 DER. Each key has a short `keyId` (the first 8 hex characters of SHA-256 of the public key).
  - `CONTACT_PUBLIC_KEY` goes to the web-api container.
  - `CONTACT_PRIVATE_KEY` goes to the admin container only.
- **Sealing a submission:**
  1. Generate an ephemeral X25519 key pair.
  2. Derive the shared secret with the recipient public key.
  3. Run HKDF-SHA256 with `info = "ranjansoft-contact-v1"` and the salt set to the ephemeral public key, giving a 32-byte AES key.
  4. Encrypt with AES-256-GCM, a 12-byte random IV, and additional authenticated data (AAD) `keyId|createdAt`.

  The plaintext is the JSON of `{firstName, lastName, email, company, service, message, ip, userAgent}`.
- **Stored document:**
  ```
  { _id, createdAt: Date, v: 1, keyId, epk: base64, iv: base64, ct: base64, tag: base64 }
  ```
  Only `createdAt`, `v` and `keyId` are readable; everything a visitor typed, plus their IP and browser, is inside `ct`. `createdAt` is indexed descending.
- **Opening a record:** the admin derives the same key with its private key and the stored `epk`, then decrypts. A wrong key, a changed `createdAt` or `keyId`, or any modified byte makes GCM authentication fail, and the record is shown as "Unreadable record".
- **Key rotation (manual, rare):** generate a new pair and set the new public key on web-api. The admin accepts a list of private keys, matched by `keyId`, so older records stay readable.
- **Rate-limit keys:** `rate_limits` stores `HMAC-SHA256(RATE_LIMIT_SECRET, "email:"+email)` and the IP equivalent, never the raw values.

## 6. Admin app (`apps/admin`)

- **Sign-in:** Auth.js v5 with the Google provider.
  - The `signIn` callback allows only addresses in `ADMIN_EMAILS` (default `hr.ranjansoft@gmail.com`) with `email_verified`; everyone else sees "Access denied".
  - Sessions are JWTs in httpOnly, Secure, SameSite=Lax cookies and expire after 8 hours.
  - Middleware protects every route except the Auth.js routes and `/signin`.
- **Hosting:** the container listens on `127.0.0.1:3100` on stock-market-server, and `tailscale serve --https=443` publishes it inside the tailnet as `https://stock-market-server.beetal-sun.ts.net/`. The Google OAuth client's redirect URI is `https://stock-market-server.beetal-sun.ts.net/api/auth/callback/google`.
- **Messages page (`/`):** a server component reads `contact_submissions`, newest first, 25 per page with `?page=N`, and decrypts on the server, so only plaintext rendered for the signed-in admin reaches the browser.
  - Each row shows the date (IST), name, email (as a `mailto:` link), company and service, and expands to show the full message, IP and browser.
  - The page shows the total count and pagination.
  - Unreadable records appear as a row with their date and an "Unreadable record" note.
- The admin connects to MongoDB itself (tailnet), read-only use of `contact_submissions`. Out of scope: deleting, marking as read, searching and exporting.
- It reuses the public site's design tokens and Archivo, with a plain table layout.

## 7. Configuration

| Variable | web-api | admin | Notes |
|---|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | ✓ | ✓ | Same meaning as today; user/password are empty while the server has no auth |
| `CONTACT_PUBLIC_KEY` | ✓ | | |
| `CONTACT_PRIVATE_KEYS` | | ✓ | Comma-separated; the first one is current |
| `RATE_LIMIT_SECRET` | ✓ | | 32 random bytes, base64 |
| `ALLOWED_ORIGINS` | ✓ | | `https://ibrijeshsoni.github.io,https://ranjansoft.github.io` |
| `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `MAIL_TO`, `ADMIN_URL` | ✓ | | Notification only, no content; `ADMIN_URL` is linked in it |
| `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL`, `ADMIN_EMAILS` | | ✓ | |

Secrets live in `.env` on the server, which is git-ignored, and `.env.example` documents every variable.

GitHub Actions needs only these repo variables: `NEXT_PUBLIC_CONTACT_API_URL` (for example `https://stock-market-server.beetal-sun.ts.net:8443`) and `PAGES_BASE_PATH`.

## 8. Deployment

- **GitHub Pages:** the repo's Pages source is set to "GitHub Actions". On every push to `master` that passes checks, CI builds `apps/web` with `BUILD_TARGET=pages` and deploys `apps/web/out`.
- **stock-market-server:** `podman-compose.yml` defines two containers:
  - `ranjansoft-web-api`, listening on `127.0.0.1:5500` (the app itself also runs on port 5500 inside the container, `PORT=5500`)
  - `ranjansoft-admin`, listening on `127.0.0.1:3100`

  Tailscale publishes them:
  ```
  tailscale funnel --bg --https=8443 http://127.0.0.1:5500   # public API
  tailscale serve  --bg --https=443  http://127.0.0.1:3100   # admin, tailnet only
  ```
  Funnel must be allowed for this node in the tailnet policy file (the `funnel` node attribute). The Funnel URL exposes the whole web-api container, so the API endpoints and the page copy are both public; the admin is never funnelled.
- **Updating the server:** CI builds both images on `master`, so a broken Dockerfile is caught. The first version is deployed by hand on the server:
  ```
  git pull
  podman-compose up -d --build
  ```
  Pushing images to a registry and automatic server deploys are out of scope.

## 9. CI (`.github/workflows/ci.yml`)

- **Every push and pull request:**
  1. `npm ci`
  2. typecheck all workspaces
  3. run the unit tests (Vitest)
  4. build `apps/web` for both targets, and build `apps/admin`
  5. build both container images
- **`master` only:** deploy `apps/web/out` to GitHub Pages.
- The current `deploy.yml` is replaced.

## 10. Testing

- **`packages/core` unit tests:**
  - sealing then opening a submission round-trips exactly
  - each of these fails to open: a wrong private key, a changed `createdAt`, and a flipped ciphertext byte
  - an unknown `keyId` is reported as such
  - validation covers each rule and the `SERVICES` list
- **`apps/web` route handler tests**, against a throwaway MongoDB started by the test (`mongodb-memory-server`):
  - success returns 201, and the stored document contains no plaintext field
  - validation errors return 400
  - the honeypot returns 201 with nothing stored
  - each of the three rate limits returns 429
  - CORS is allowed for listed origins and refused for others
  - malformed JSON returns 400
- **Admin:**
  - the sign-in callback allows only allow-listed, verified emails
  - the messages loader decrypts records and marks tampered ones as unreadable
- **Local end-to-end with podman** before anything goes live:
  1. Build the Pages target and serve it from a separate nginx container.
  2. Run web-api and admin with compose.
  3. Submit through the real form with Playwright, then confirm the stored document is ciphertext.
  4. Open the admin with a test session and confirm the message appears.
  5. Check the public pages for horizontal overflow at 320, 375, 768, 1024, 1440 and 2560 px in both themes, against the current site.
  6. Remove the test records afterwards.

## 11. Out of scope

- Vercel
- exposing MongoDB publicly
- multiple admins or roles
- deleting or replying to messages from the admin
- search
- automatic server deploys from CI
- a custom domain (it can be added later through Pages settings and `PAGES_BASE_PATH`)
- enabling authentication on the shared MongoDB server (recommended separately, since that server also holds other apps' databases)

## 12. Risks and notes

- **Anyone on the tailnet can read or write the shared MongoDB server, which has no auth.** Encryption keeps message content safe, but someone with access could delete or flood records. Enabling auth on that server later only needs `DB_USER` and `DB_PASSWORD`.
- **Losing the private key makes every stored message permanently unreadable.** The keygen step tells the owner to keep an offline copy.
- **If the server or Funnel is down, the GitHub Pages form shows the "could not be sent" message.** The rest of the site keeps working.
- **The `/ranjansoft` base path must be updated if the site moves to `ranjansoft.github.io`.** Set `PAGES_BASE_PATH` to empty and add that origin to `ALLOWED_ORIGINS`; it is already in the default.

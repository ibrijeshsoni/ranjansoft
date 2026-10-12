# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RanjanSoft's company website is a **single self-contained `index.html`** (about 145 KB). It has no build step, framework, linter or tests. The CSS and JS are inline, so edit `index.html` directly. The only backend is `api/`, a small Node/Express service that stores contact form submissions in MongoDB (see below).

## Run / preview

```bash
python3 -m http.server 8000                         # quickest local preview -> http://localhost:8000
cp .env.example .env                                # once: DB_HOST/DB_PORT, SMTP creds, ALLOWED_ORIGINS
podman-compose -f podman-compose.yml up -d --build  # web (nginx) + api on http://localhost:10105
podman-compose -f podman-compose.yml down
```

- `podman-compose.tml` is a stray duplicate with a typo in the extension. Use `podman-compose.yml`.
- `gen-self-signed-cert.sh` writes a local-only TLS cert into `certs/`. The Dockerfile serves plain HTTP on port 80 only.
- CI/CD is `.github/workflows/deploy.yml`. On every push or PR, `check` runs `node --check` on the API, verifies the form's service `<option>`s match `SERVICES` in `api/server.js`, and builds both images. On pushes to `master`, `deploy-pages` then publishes **only `index.html`** to GitHub Pages, writing the repo variable `CONTACT_API_URL` (must be `https://`) into the form's `data-api`. This needs the repo's Settings → Pages source set to "GitHub Actions". The API is not deployed by CI; it runs from the podman stack.
- `python3 -m http.server` serves the page only, so the contact form has no API behind it there.

## Deploy constraint

The Dockerfile copies **only `index.html`** (plus `site.conf` as the nginx config) into the image. Any new local asset (image, favicon, CSS/JS file) needs a matching `COPY` line, or it must be inlined. For example, the favicon is an inline SVG data URI for this reason. External assets come from CDNs: Google Fonts (Archivo, variable width + weight) and devicon / simpleicons SVGs.

## How `index.html` is organised

- **Design tokens** ("Blueprint & Marigold") live at the top of `<style>`: `:root` is the dark blueprint-navy theme, `[data-theme="light"]` the drafting-paper theme. Marigold `--accent-fill` (#F2B33D) is the brand fill in both modes with `--on-accent` text; `--accent` is marigold as text/lines (darkened to #8F5600 on light); `--line` is blueprint blue for diagrams. Change colours through these tokens, not hard-coded values.
- **Type:** one family, Archivo. Width carries hierarchy: headlines use `font-stretch: var(--w-display)` / 125%, labels and data `var(--w-label)` (condensed). Accent `.tc` spans inside headings are deliberately neutralised to the heading colour.
- **Theming:** an inline script in `<head>` sets `data-theme` before paint from `localStorage['rs-theme']`, else the OS `prefers-color-scheme`. `toggleTheme()` flips and saves it.
- **Pages:** a client-side SPA with hash routing (`#about`, `#services`, `#projects`, `#contact`; home has no hash). Each page is a `<div class="page" id="page-<name>">`. `goto('<name>')` pushes history and calls `showPage()`, which toggles `.active` on the page and on nav links matched by `data-page="<name>"`; back/forward and deep links work via `popstate` and the hash on load. Nav exists twice, in the desktop `.nav-links` and the mobile `#mob-menu`, so a nav change has to be made in both. The Contact page markup exists but its nav links are commented out.
- **Scroll fade-in:** `fi` / `initFI()` still exist as hooks, but `.fi` is styled to be static on purpose. The only load animation is the hero schematic (dimension lines + cable draw), and all motion is disabled under `prefers-reduced-motion`.
- **Hero schematic:** the `.schematic` block on the home page is an `<ol class="chain">` of five nodes with `.dims` dimension lines above it. Networks and Servers & hosting are currently hidden with the `hidden` attribute, so three nodes show: `.chain` is `repeat(3,1fr)`, `.dims` is `1fr 2fr` (Hardware 1 column, Software 2) and the cable inset is `calc(100% / 6)`. To restore them, remove `hidden` and go back to `repeat(5,1fr)`, `3fr 2fr` and a 10% inset. Adding or removing a node always means changing that split. At ≤768px it turns vertical, and the Hardware/Software labels come from `::before` on `li:nth-child(1)` and `li:nth-child(4)`.
- **Tech logos:** some monochrome logos carry an inline `style="filter:invert(1)"` for the dark theme. A `[data-theme="light"]` rule undoes it with `!important`. Give any new black or white logo the same inline style.
- **Counters:** `data-cnt="<number>"` plus an optional `data-sfx="+"` animate on load.
- **Projects:** each `.proj-card` carries `data-status="current|hold|delivered"`. `filterProj()` filters the cards, and `updateProjCounts()` fills the `#cnt-all/#cnt-curr/#cnt-hold/#cnt-done` badges automatically, so adding a card needs no count edits.
- **Tech stack tabs:** the second `<script>` turns each `.tech-category` label inside `#tech-panels-container` into a tab button. The grid that follows each label is the panel. The default tab is index 2 ("Backend & API"), so inserting or reordering categories shifts that default.

## Contact form backend

- `#contact-form` in `index.html` POSTs JSON to `<data-api>/api/contact`. `data-api` is empty, meaning same origin, which works when the podman stack serves the page. For the GitHub Pages copy, set it to the API's public **HTTPS** URL and list the Pages origin in `ALLOWED_ORIGINS` (CORS).
- `site.conf` makes nginx proxy `/api/` to the `api` container (`api/server.js`, port 3000). The API validates the fields, saves them to the `ranjansoft.contact_submissions` collection on the external MongoDB server (`DB_HOST`/`DB_PORT`; currently `stock-market-server.beetal-sun.ts.net:27017` over Tailscale, so the host running the stack must be on that tailnet), then emails `MAIL_TO` through SMTP (skipped when `SMTP_HOST` is empty). The email failing never fails the request.
- The service list in `api/server.js` (`SERVICES`) must match the form's `<option>`s, and field names and lengths must match its inputs. Change both together.
- That server currently has no auth, so `DB_USER`/`DB_PASSWORD` are empty. Set both once auth is enabled (`authSource` defaults to `admin`), or override everything with `MONGODB_URI`. To read submissions: `mongosh mongodb://stock-market-server.beetal-sun.ts.net:27017/ranjansoft`, then `db.contact_submissions.find().sort({createdAt:-1})`.
- Rate limits are keyed by sender email plus a global cap, not by IP, because rootless podman's port forwarding makes every visitor appear as the same address. A hidden `website` honeypot field silently drops bots.
- Secrets live in `.env` (git-ignored). `.env.example` is the template.

## Responsive layout

The breakpoints are `max-width` media queries in one block at the end of `<style>`: 1024, 768, 480 and 400px. `--nav-h` is 68px, dropping to 60px at ≤768. The hero, `.ph` and the sticky tech tab bar all offset from `--nav-h`, so change the nav height through that token. The ≤400px block drops headings from expanded to normal width; expanded type overflows on 320px phones. The footer's `margin-left:100px` is inline in the HTML and is reset with `!important` at ≤768.

There are no tests. To verify a change, serve the site and check every page for horizontal overflow at roughly 320, 375, 768, 1024, 1440 and 2560px wide, in both themes. Pages can be opened directly by hash, e.g. `/#services`, or by calling `showPage('<name>')` from the console.

## Tooling noise

`.claude-flow/`, `.swarm/` and `ruvector.db` are generated by local agent tooling (ruflo). They are not part of the site, so don't edit them by hand. Some `.claude-flow/` files are already tracked, so leave their churn out of site commits. `deployment-ducument.*` are standalone docs, not served by the site.

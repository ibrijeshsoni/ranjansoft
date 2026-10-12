# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RanjanSoft's company website is a **single self-contained `index.html`** (about 140 KB). It has no build step, framework, package manager, linter or tests. The CSS and JS are inline, so edit `index.html` directly.

## Run / preview

```bash
python3 -m http.server 8000                         # quickest local preview -> http://localhost:8000
podman-compose -f podman-compose.yml up -d --build  # nginx:1.27-alpine container on http://localhost:10105
podman-compose -f podman-compose.yml down
```

- `podman-compose.tml` is a stray duplicate with a typo in the extension. Use `podman-compose.yml`.
- `gen-self-signed-cert.sh` writes a local-only TLS cert into `certs/`. The Dockerfile serves plain HTTP on port 80 only.
- There is no CI workflow in the repo (`.github/` does not exist). Deployment means building the Dockerfile.

## Deploy constraint

The Dockerfile copies **only `index.html`** into the nginx web root. Any new local asset (image, favicon, CSS/JS file) needs a matching `COPY` line, or it must be inlined. For example, the favicon is an inline SVG data URI for this reason. External assets come from CDNs: Google Fonts (Archivo, variable width + weight) and devicon / simpleicons SVGs.

## How `index.html` is organised

- **Design tokens** ("Blueprint & Marigold") live at the top of `<style>`: `:root` is the dark blueprint-navy theme, `[data-theme="light"]` the drafting-paper theme. Marigold `--accent-fill` (#F2B33D) is the brand fill in both modes with `--on-accent` text; `--accent` is marigold as text/lines (darkened to #8F5600 on light); `--line` is blueprint blue for diagrams. Change colours through these tokens, not hard-coded values.
- **Type:** one family, Archivo. Width carries hierarchy: headlines use `font-stretch: var(--w-display)` / 125%, labels and data `var(--w-label)` (condensed). Accent `.tc` spans inside headings are deliberately neutralised to the heading colour.
- **Theming:** an inline script in `<head>` sets `data-theme` before paint from `localStorage['rs-theme']`, else the OS `prefers-color-scheme`. `toggleTheme()` flips and saves it.
- **Pages:** a client-side SPA with hash routing (`#about`, `#services`, `#projects`, `#contact`; home has no hash). Each page is a `<div class="page" id="page-<name>">`. `goto('<name>')` pushes history and calls `showPage()`, which toggles `.active` on the page and on nav links matched by `data-page="<name>"`; back/forward and deep links work via `popstate` and the hash on load. Nav exists twice, in the desktop `.nav-links` and the mobile `#mob-menu`, so a nav change has to be made in both. The Contact page markup exists but its nav links are commented out.
- **Scroll fade-in:** `fi` / `initFI()` still exist as hooks, but `.fi` is styled to be static on purpose. The only load animation is the hero schematic (dimension lines + cable draw), and all motion is disabled under `prefers-reduced-motion`.
- **Hero schematic:** the `.schematic` block on the home page is an `<ol class="chain">` of five nodes with `.dims` dimension lines above it. The Hardware span covers 3 columns and Software covers 2 (`grid-template-columns: 3fr 2fr`), so adding or removing a node means changing that split. At ≤768px it turns vertical, and the Hardware/Software labels come from `::before` on `li:nth-child(1)` and `li:nth-child(4)`.
- **Tech logos:** some monochrome logos carry an inline `style="filter:invert(1)"` for the dark theme. A `[data-theme="light"]` rule undoes it with `!important`. Give any new black or white logo the same inline style.
- **Counters:** `data-cnt="<number>"` plus an optional `data-sfx="+"` animate on load.
- **Projects:** each `.proj-card` carries `data-status="current|hold|delivered"`. `filterProj()` filters the cards, and `updateProjCounts()` fills the `#cnt-all/#cnt-curr/#cnt-hold/#cnt-done` badges automatically, so adding a card needs no count edits.
- **Tech stack tabs:** the second `<script>` turns each `.tech-category` label inside `#tech-panels-container` into a tab button. The grid that follows each label is the panel. The default tab is index 2 ("Backend & API"), so inserting or reordering categories shifts that default.

## Responsive layout

The breakpoints are `max-width` media queries in one block at the end of `<style>`: 1024, 768, 480 and 400px. `--nav-h` is 68px, dropping to 60px at ≤768. The hero, `.ph` and the sticky tech tab bar all offset from `--nav-h`, so change the nav height through that token. The ≤400px block drops headings from expanded to normal width; expanded type overflows on 320px phones. The footer's `margin-left:100px` is inline in the HTML and is reset with `!important` at ≤768.

There are no tests. To verify a change, serve the site and check every page for horizontal overflow at roughly 320, 375, 768, 1024, 1440 and 2560px wide, in both themes. Pages can be opened directly by hash, e.g. `/#services`, or by calling `showPage('<name>')` from the console.

## Tooling noise

`.claude-flow/`, `.swarm/` and `ruvector.db` are generated by local agent tooling (ruflo). They are not part of the site, so don't edit them by hand. Some `.claude-flow/` files are already tracked, so leave their churn out of site commits. `deployment-ducument.*` are standalone docs, not served by the site.

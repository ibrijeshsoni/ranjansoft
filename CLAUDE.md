# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

RanjanSoft's company website is a **single self-contained `index.html`** (about 130 KB). It has no build step, framework or package manager. The CSS and JS are inline, so edit `index.html` directly.

## Run / preview

```bash
python3 -m http.server 8000                         # quickest local preview -> http://localhost:8000
podman-compose -f podman-compose.yml up -d --build  # nginx:1.27-alpine container on http://localhost:10105
podman-compose -f podman-compose.yml down
```

- `podman-compose.tml` is a stray duplicate with a typo in the extension. Use `podman-compose.yml`.
- `gen-self-signed-cert.sh` writes a local-only TLS cert into `certs/`. The Dockerfile serves plain HTTP on port 80 only.

## Deploy

On pushes and PRs to `master`, on `v*.*.*` tags, and on a daily cron, `.github/workflows/docker-publish.yml` builds the Dockerfile and publishes the image to `ghcr.io/<owner>/ranjansoft`. The image contains only `index.html`, so any new asset file needs a matching `COPY` line in the Dockerfile.

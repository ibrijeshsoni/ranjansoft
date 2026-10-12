# Deploying to stock-market-server

Pushes to `master` deploy themselves:

1. GitHub Actions (`.github/workflows/deploy.yml`) checks the code, then the `publish-images` job pushes two images to GitHub's container registry:
   - `ghcr.io/ibrijeshsoni/ranjansoft-web` (nginx: the site, and a proxy for `/api/`)
   - `ghcr.io/ibrijeshsoni/ranjansoft-api` (the contact API)

   Each image is tagged `latest` and `sha-<commit>`.
2. On the server, a systemd user timer runs `update.sh` every 5 minutes. It pulls both images and recreates the containers if either one changed.
3. It then checks `http://127.0.0.1:10105/api/health` for up to 60 seconds:
   - **Healthy:** the old images are pruned.
   - **Unhealthy:** it rolls back to the previous images and records the bad image in `.bad-images`, so the next runs skip it. Pushing a fixed commit deploys normally again.

GitHub never connects to the server; the server only pulls.

## One-time setup on the server

Run these as the user that should own the containers, not as root:

```bash
git clone https://github.com/ibrijeshsoni/ranjansoft.git ~/ranjansoft
cd ~/ranjansoft/deploy
./install.sh          # first run creates deploy/.env from ../.env.example and stops
nano .env             # fill in DB_*, SMTP_*, ALLOWED_ORIGINS
./install.sh          # installs the timer and deploys once
```

`install.sh` needs `podman`, `podman-compose` and `curl`, and enables lingering so the timer keeps running after you log out. If it can't enable lingering, run `sudo loginctl enable-linger $USER`.

### Registry access

The first time CI pushes, GHCR creates both packages. If they are private, the server's pull fails, and the log tells you so. Use either fix:

- **Make the packages public (simplest).** The images contain no secrets, because secrets come from `deploy/.env` at runtime. On GitHub, open your profile → Packages → each package → Package settings → Change visibility → Public.
- **Log in on the server.** Create a classic personal access token with only `read:packages`, then run `podman login ghcr.io -u ibrijeshsoni`.

### Database host

`DB_HOST=stock-market-server.beetal-sun.ts.net` points at the server itself. If the API container can't reach that name, set `DB_HOST=host.containers.internal` in `deploy/.env`.

## Day to day

| Task | Command |
|---|---|
| Watch deploys | `journalctl --user -u ranjansoft-update -f` |
| Deploy now instead of waiting | `systemctl --user start ranjansoft-update` |
| Timer status / next run | `systemctl --user list-timers ranjansoft-update.timer` |
| Container logs | `podman logs -f ranjansoft-api` |
| Pin a specific commit | set `IMAGE_TAG=sha-<full commit sha>` in `.env`, then start the update |
| Clear the bad-image list | `rm .bad-images` |
| Stop auto-deploys | `systemctl --user disable --now ranjansoft-update.timer` |

Changes to `deploy/podman-compose.server.yml` or `update.sh` are not pulled automatically. After such a change, run `git pull` in `~/ranjansoft`.

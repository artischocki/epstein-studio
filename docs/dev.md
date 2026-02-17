# Development Guide

## Environment
- Python environment and tooling are managed with `uv`.
- Node.js (for Electron desktop app scripts).
- Main Django entry point: `backend/manage.py`.
- Main app: `backend/apps/epstein_ui`.
- Electron desktop shell entry point: `electron/main.js`.
- User identity:
  - No login/register flow.
  - Middleware creates a persistent anonymous hash (`epstein_user_hash` cookie) and uses it as `request.user.username`.
  - Frontend templates always expose authenticated mode (`data-auth="1"`) and consume the persistent hash as `data-user`.

## Local Setup
1. Install dependencies:
   - `uv sync`
   - `nvm install 20.19.0`
   - `nvm use 20.19.0`
2. Run migrations:
   - `uv run python backend/manage.py migrate`
3. Start dev server:
   - `uv run python backend/manage.py runserver`

## Common Commands
- Create migrations:
  - `uv run python backend/manage.py makemigrations`
- Apply migrations:
  - `uv run python backend/manage.py migrate`
- Collect static:
  - `uv run python backend/manage.py collectstatic --noinput`
- Reindex PDFs:
  - `uv run python backend/manage.py index_pdfs`
- Annotation read endpoint behavior:
  - `GET /annotations/?pdf=<filename.pdf>` returns an empty `annotations` list by design while decentralization work is in progress.
- Annotation write/comment/vote endpoint behavior:
  - `POST /annotations/`, `POST /annotation-votes/`, `GET|POST /annotation-comments/`, `POST /comment-votes/`, and `POST /comment-delete/` return `410`.
- Local annotation persistence behavior:
  - Frontend stores annotations in `localStorage` (scoped by persistent `data-user` hash + PDF filename).
  - Annotation edits persist across reloads on the same browser/device profile.
  - In Electron, each committed annotation edit also publishes a per-PDF state event over libp2p.
  - Remote events from peers are merged into local state and reflected in the currently open PDF view.
- Auth route behavior:
  - `/login/`, `/register/`, `/logout/`, and `/username-check/` are removed.
- Run desktop app:
  - `nvm use 20.19.0`
  - `npm install`
  - `npm run electron:dev`
  - Multi-peer debug mode: `ELECTRON_DEBUG_MULTI=1 npm run electron:dev`
    - Starts a second Electron process with separate `userData` (`peer-2`) so both windows can run simultaneously.
    - Peer 2 uses the same Django URL and libp2p topic for local annotation sync verification.
    - Bootstrap dialing is auto-wired from peer 1 listen addresses (normalized to dialable localhost + `/p2p/<peerId>`).
    - Startup logs include explicit discovery dial attempts by peer id (`dial ok peer=...` / `dial failed peer=...`) for easier connectivity debugging.
  - On startup, Electron attempts to boot a libp2p node and logs status with `[libp2p] ...` lines.
  - Current runtime mesh uses gossipsub + identify + bootstrap discovery (DHT is not required for local peer test mode).
  - Publish/apply traces include `publish request`, `publish peers`, `publish ok`, `message topic`, `direct send ok`, `direct recv`, and `broadcast kind=...` lines.
  - In local multi-window Electron runs, published annotation events are also relayed across the parent/child Electron processes via debug IPC fallback for immediate sync verification.
  - Opening a PDF triggers a p2p annotation snapshot request (`epstein.annotation.request`) with short retries so peers can return existing annotations immediately.
  - Snapshot responses can be served from local persisted annotation state even if the requested PDF is not currently open in the responding peer.
  - Optional libp2p overrides:
    - `LIBP2P_BOOTSTRAP` (comma-separated multiaddrs)
    - `LIBP2P_LISTEN` (comma-separated listen multiaddrs)
    - `LIBP2P_TOPIC` (default: `epstein/annotations/v1`)
  - Electron keeps native OS title bar controls and auto-hides the app menu row (`File/Edit/...`) by default.
  - Uses `127.0.0.1:8000` by default; if occupied, it scans for the next free port.
  - Optional overrides: `ELECTRON_DJANGO_HOST`, `ELECTRON_DJANGO_PORT`.
  - On Linux/Ubuntu (including Pop!_OS), Electron is forced to `ozone-platform=x11` by default for reliable native title bar controls.
  - Optional Linux overrides: `ELECTRON_OZONE_PLATFORM` or `ELECTRON_OZONE_PLATFORM_HINT`.
  - When running with Wayland (`ELECTRON_OZONE_PLATFORM=wayland`), GPU acceleration is disabled automatically to avoid blank windows on some Linux GPU/driver setups.
  - Manual fallback: `ELECTRON_DISABLE_GPU=1 npm run electron:dev`.

## Paths You Will Touch Most
- Templates: `backend/apps/epstein_ui/templates/epstein_ui/`
- Static JS/CSS: `backend/apps/epstein_ui/static/epstein_ui/`
- Views: `backend/apps/epstein_ui/views.py`
- URLs: `backend/apps/epstein_ui/urls.py`
- Models: `backend/apps/epstein_ui/models.py`

## Static Asset Rules
- Prefer `{% static %}` in templates.
- Avoid hardcoded `/static/...` paths where template resolution is possible.
- If JS creates static URLs dynamically, use a template-injected static base.

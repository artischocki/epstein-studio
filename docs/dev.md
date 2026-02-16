# Development Guide

## Environment
- Python environment and tooling are managed with `uv`.
- Node.js (for Electron desktop app scripts).
- Main Django entry point: `backend/manage.py`.
- Main app: `backend/apps/epstein_ui`.
- Electron desktop shell entry point: `electron/main.js`.

## Local Setup
1. Install dependencies:
   - `uv sync`
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
- Run desktop app:
  - `npm install`
  - `npm run electron:dev`
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

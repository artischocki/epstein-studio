# Epstein Studio

A collaborative workspace for annotating, discussing, and investigating redacted PDF documents. Built for the crowd-sourced effort to dig through the Epstein files.

**Live at [epstein-studio.com](https://epstein-studio.com)**

---

## What Is This

Epstein Studio renders PDF pages in the browser and lets users pin annotations directly onto the documents. Each annotation can include notes, styled text overlays, and arrow hints. Every annotation has its own discussion thread with voting, so the community can highlight what matters and surface the most promising findings.

### Features

- **PDF Viewer** -- Pan, zoom, and navigate multi-page PDFs rendered as images
- **Annotations** -- Place anchor points on any page with notes, text overlays, and directional arrows
- **Text Overlays** -- Custom font, size, color, and opacity for marking up redacted or important sections
- **Arrow Hints** -- Draw arrows to point out connections or areas of interest
- **Discussions** -- Threaded comments on both annotations and entire PDFs
- **Voting** -- Upvote/downvote annotations and PDFs to surface the most promising leads
- **Search & Browse** -- Full-text search with autocomplete, sortable browse grid, random file picker
- **Notifications** -- Get notified when someone replies to your comments
- **Heatmap** -- Visual density overlay showing where annotations cluster on a page

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Django 5.2 |
| Database | PostgreSQL 16 |
| PDF Rendering | poppler-utils (pdftoppm) |
| Server | Gunicorn |
| Frontend | Vanilla JS, SVG canvas |
| Desktop Shell | Electron |
| Package Manager | uv |
| Deployment | Docker Compose |

---

## Getting Started

### Prerequisites

- Python 3.9+
- PostgreSQL
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- Node.js 16+ (for Electron desktop app)
- System package: `poppler-utils`

### Local Development

```bash
# install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

# install dependencies
uv sync

# set up your environment
cp .env.example .env  # then edit with your DB credentials

# run migrations
uv run python backend/manage.py migrate

# index PDF files (point DATA_DIR to your PDF directory)
uv run python backend/manage.py index_pdfs

# start the dev server
uv run python backend/manage.py runserver
```

### Docker

```bash
# bring up postgres + web server
docker compose up --build

# run migrations inside the container
docker compose exec web uv run python manage.py migrate

# index PDFs
docker compose exec web uv run python manage.py index_pdfs
```

### Desktop App (Electron)

```bash
# install electron dependencies
npm install

# start desktop app (spawns Django server automatically)
npm run electron:dev
```

Notes:
- Default URL target is `127.0.0.1:8000`.
- If port `8000` is already used by another service, the Electron launcher auto-selects the next free port.
- You can override host/port with `ELECTRON_DJANGO_HOST` and `ELECTRON_DJANGO_PORT`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DJANGO_SECRET_KEY` | Django secret key |
| `DB_NAME` | PostgreSQL database name |
| `DB_USER` | PostgreSQL user |
| `DB_PASSWORD` | PostgreSQL password |
| `DB_HOST` | Database host (default: `db` in Docker, `localhost` for local) |
| `DB_PORT` | Database port (default: `5432`) |
| `ALLOWED_HOSTS` | Comma-separated list of allowed hostnames |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated list of trusted origins |
| `DATA_DIR` | Path to the directory containing PDF files |

---

## Project Structure

```
epstein/
├── backend/
│   ├── manage.py
│   ├── backend/              # Django project config
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── wsgi.py
│   ├── apps/
│   │   └── epstein_ui/       # Main application
│   │       ├── models.py     # Annotations, votes, comments, notifications
│   │       ├── views.py      # API endpoints and page views
│   │       ├── templates/    # HTML templates
│   │       └── static/       # JS, CSS, fonts, icons
├── electron/
│   └── main.js               # Electron main process (starts Django + opens desktop window)
├── package.json              # Electron scripts/dependencies
├── pyproject.toml
├── uv.lock
├── Dockerfile
└── docker-compose.yml
```

---

## Contributing

This is an open investigation tool. If you want to help:

1. Fork the repo
2. Create a branch
3. Make your changes
4. Open a PR

---

## License

MIT LICENSE

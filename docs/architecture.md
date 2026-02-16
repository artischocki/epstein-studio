# Architecture Overview

## High-Level
- Django monolith with server-rendered templates.
- Interactive behavior implemented with static JS files.
- PDF metadata and collaboration data in SQL database.
- Repository/package metadata is centered on `epstein-studio`; no separate OCR/extractor subsystem is part of the app runtime.

## Main Components
- Web app:
  - Templates and static assets under `backend/apps/epstein_ui/`.
- Desktop shell:
  - Electron main process in `electron/main.js`.
  - Starts Django locally, then loads the app URL in a desktop window.
  - Uses the default native OS title bar with standard window controls.
- API-like endpoints:
  - Implemented in `backend/apps/epstein_ui/views.py`.
- Routing:
  - `backend/apps/epstein_ui/urls.py`.
- Data models:
  - `backend/apps/epstein_ui/models.py`.

## Core Data Domains
- PDF index (`PdfDocument`):
  - Filename/path metadata
  - Aggregate counters (`annotation_count`, `vote_score`)
- PDF-level discussion:
  - `PdfComment`, `PdfCommentReply`, votes
- Notifications:
  - Notification records for replies/interactions

## Frontend Structure
- Main canvas experience:
  - Template: `templates/epstein_ui/index.html`
  - JS: `static/epstein_ui/app.js`
- Browse view:
  - Template: `templates/epstein_ui/browse.html`
  - JS: `static/epstein_ui/browse.js`
- Shared styles:
  - `static/epstein_ui/style.css`

## Annotation Read Path
- Django no longer stores annotation rows/tables.
- `GET /annotations/` returns:
  - `annotations: []`
  - `pdf_comments: [...]` (still server-backed)
- Annotation mutation/comment/vote endpoints in Django return `410 Gone` and are deprecated in favor of decentralized sync.

## PDF Indexing and Counters
- Index refresh command:
  - `uv run python backend/manage.py index_pdfs`
- Counts are maintained both by command refresh and event-driven updates (signals/views), depending on flow.

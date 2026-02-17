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
  - Starts a local libp2p node (TCP/WS transports, Noise connection encrypters, gossipsub + identify + bootstrap discovery) for annotation transport.
  - If gossipsub has zero topic subscribers at publish time, Electron falls back to a direct libp2p stream protocol (`/epstein/annotations/1.0.0`) to connected peers.
  - Uses `electron/preload.js` to expose a narrow IPC bridge for annotation sync events.
- API-like endpoints:
  - Implemented in `backend/apps/epstein_ui/views.py`.
- Identity middleware:
  - `PersistentUserHashMiddleware` auto-creates and logs in an anonymous user hash stored in a persistent cookie.
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
- Frontend annotation persistence is currently local-first:
  - `app.js` saves annotation state in browser `localStorage` per `(user_hash, pdf_key)`.
  - Reloading the same browser/device restores annotations without Django DB storage.
  - In Electron, committed annotation state is broadcast as signed-less libp2p events (`epstein.annotation.state`) on `LIBP2P_TOPIC`.
  - When a PDF is opened, renderer emits `epstein.annotation.request` events so connected peers can immediately rebroadcast their local snapshot for that PDF.
  - Request responders load snapshot data from in-memory state and local persisted storage, so a peer can answer even when that PDF is not currently active in the UI.
  - Incoming events update per-PDF local state and are immediately applied to the active canvas when viewing the same PDF.

## PDF Indexing and Counters
- Index refresh command:
  - `uv run python backend/manage.py index_pdfs`
- Counts are maintained both by command refresh and event-driven updates (signals/views), depending on flow.

# Operations Playbook

## Reindex PDFs
- Command:
  - `uv run python backend/manage.py index_pdfs`
- In Docker:
  - `docker-compose exec web uv run python backend/manage.py index_pdfs`
- Behavior:
  - Syncs DB PDF index with files on disk.
  - Refreshes aggregate counters used by browse sorting and metadata.

## When Browse Looks Wrong or Slow
1. Verify DB schema is migrated:
   - `uv run python backend/manage.py migrate`
2. Rebuild index/counters:
   - `uv run python backend/manage.py index_pdfs`
3. Check query/response timing via browser network panel and server logs.

## Annotation Visibility Note
- Server-side annotation storage is removed:
  - Django keeps no annotation tables.
  - `GET /annotations/` returns no annotation rows.
  - Annotation mutation/comment/vote endpoints return `410`.
- If users report "no annotations visible", confirm whether the client is expected to source them from decentralized sync instead of Django DB.

## Static/UI Update Issues
Symptoms:
- Users only see new UI after hard refresh.

Checks:
1. Ensure static URLs are not hardcoded where manifest resolution is expected.
2. Run collectstatic after deploy:
   - `uv run python backend/manage.py collectstatic --noinput`
   - or Docker equivalent.
3. Verify browser receives updated static file URLs/content.

## Common Runtime Checks
- App process health:
  - `docker-compose ps`
- App logs:
  - `docker-compose logs --tail=200 web`
- DB logs:
  - `docker-compose logs --tail=200 db`

## Recovery Pattern (Safe)
1. Pull latest code.
2. `docker-compose up --build -d`
3. `docker-compose exec web uv run python backend/manage.py migrate`
4. `docker-compose exec web uv run python backend/manage.py collectstatic --noinput`
5. `docker-compose exec web uv run python backend/manage.py index_pdfs`

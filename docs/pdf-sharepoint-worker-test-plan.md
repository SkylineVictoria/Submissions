# PDF SharePoint background worker — local/dev test plan

Do **not** enable production cron until Render Free capacity is verified.

## Prerequisites

1. Apply migrations:
   - `supabase/migrations/20260703180000_skyline_generated_pdfs.sql`
   - `supabase/migrations/20260706140000_enqueue_pdf_on_instance_complete.sql` (auto-queue trigger + backfill)
2. Set env vars (see root `.env.example` — never commit secrets)
3. Run pdf-server locally: `cd pdf-server && npm run dev`
4. SharePoint app registration with `Sites.ReadWrite.All` (or Files.ReadWrite.All) for upload

## Test 0: Auto-queue on completion

1. Complete an assessment (office final submit) so `status = 'locked'` and `workflow_status = 'completed'`.
2. **Expected:** Row appears in `skyline_generated_pdfs` with `pdf_status = 'pending'` without opening the PDF panel.
3. Existing completed instances are backfilled by the migration (one-time `INSERT` for missing rows).

Optional async worker wake-up (production): configure Vault secrets `project_url`, `service_role_key`, and optionally `pdf_worker_cron_secret`, then enable `pg_net`. The DB trigger calls `trigger-pdf-worker` when a **new** queue row is inserted.

## Test 1: Single pending PDF

1. Pick a **completed** `skyline_form_instances.id` (`status = 'locked'` and `workflow_status = 'completed'`).
2. Confirm a row exists in `skyline_generated_pdfs` (auto-created by trigger/backfill), or insert manually:
   ```sql
   INSERT INTO skyline_generated_pdfs (instance_id, role, pdf_status)
   VALUES (<id>, 'office', 'pending')
   ON CONFLICT (instance_id, role) DO UPDATE SET pdf_status = 'pending', sharepoint_web_url = NULL;
   ```
3. Call worker:
   ```bash
   curl -X POST http://localhost:3001/jobs/process-pdfs \
     -H "Content-Type: application/json" \
     -H "x-worker-secret: YOUR_PDF_WORKER_SECRET" \
     -d '{"limit":1,"role":"office"}'
   ```
4. **Expected:** `pending` → `generating` → `uploaded`, SharePoint file exists, Supabase URLs populated.

## Test 2: Duplicate protection

1. Start Test 1 processing (slow instance or add logging delay).
2. Immediately call `/jobs/process-pdfs` again.
3. **Expected:** Second call returns `503` worker busy **or** `skipped` for locked row — no duplicate upload.

## Test 3: Batch safety

1. Create 5 rows with `pdf_status = 'pending'`.
2. `curl ... -d '{"limit":2}'`
3. **Expected:** At most 2 processed per request; others stay `pending`; no deep in-memory queue.

## Test 4: Invalid instance

1. Insert `instance_id = 999999999` pending row.
2. Run worker.
3. **Expected:** Row moves to `failed` or `pending` with `retry_count` increment and `last_error` set; worker returns `ok: true` with `failed: 1`.

## Test 5: Frontend

1. Open office instance fill page for a completed assessment.
2. **Expected:** No automatic request to `GET /pdf/:id` in Network tab on load.
3. With `uploaded` row + URL: Preview/Download use SharePoint URL.
4. With `pending`: queued message shown.
5. With `failed`: Retry button visible (admin/debug mode shows `last_error`).

## Test 6: Public link disabled

1. Set `SHAREPOINT_CREATE_PUBLIC_LINK=false`.
2. Run worker successfully.
3. **Expected:** `sharepoint_web_url` set; `sharepoint_public_url` null; job still `uploaded`.

## Test 7: Render protection

1. While one job runs, second POST to `/jobs/process-pdfs`.
2. **Expected:** `503` `{ "ok": false, "message": "PDF worker busy, retry later" }`.

## Manual edge function trigger (dev)

```bash
curl -X POST "https://<project>.supabase.co/functions/v1/trigger-pdf-worker" \
  -H "Authorization: Bearer <SERVICE_ROLE_OR_ANON_IF_ALLOWED>" \
  -H "Content-Type: application/json" \
  -H "x-pdf-worker-cron-secret: <optional>" \
  -d '{"limit":1,"role":"office"}'
```

## UptimeRobot

Point health checks **only** to `GET /health` — never `/pdf/*` or `/jobs/process-pdfs`.

## Future schedule (not enabled yet)

Plan: Supabase cron 12:00–04:00 AEDT calling `trigger-pdf-worker` with `limit: 1`.

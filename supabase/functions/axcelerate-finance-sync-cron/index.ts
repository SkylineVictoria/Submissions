// Scheduled full finance sync: chains axcelerate-finance-sync batches until hasMore is false.
// Invoked daily by pg_cron (see migration 20260605100000_ax_finance_sync_daily_cron.sql).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-finance-sync-cron-secret, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BATCH_GAP_MS = 400;
/** Stop chaining before the Edge Function wall-clock limit (~150s). */
const MAX_RUNTIME_MS = 140_000;

type CronRequestBody = {
  offset?: number;
};

type SyncBatchResponse = {
  success: boolean;
  message?: string;
  syncedContacts?: number;
  syncedInvoices?: number;
  insertedOrUpdated?: number;
  errors?: string[];
  nextOffset?: number | null;
  hasMore?: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthorized(req: Request): boolean {
  const secret = (Deno.env.get('FINANCE_SYNC_CRON_SECRET') ?? '').trim();
  if (!secret) return true;

  const header =
    (req.headers.get('x-finance-sync-cron-secret') ?? req.headers.get('x-cron-secret') ?? '').trim();
  if (header === secret) return true;

  const auth = (req.headers.get('Authorization') ?? '').trim();
  if (auth === `Bearer ${secret}`) return true;

  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed. Use POST.' }, 405);
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);
  }

  let body: CronRequestBody = {};
  try {
    body = (await req.json()) as CronRequestBody;
  } catch {
    body = {};
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, message: 'Supabase service role is not configured.' }, 500);
  }

  const startedAt = Date.now();
  let offset = Math.max(0, Number(body.offset ?? 0) || 0);
  let batches = 0;
  let syncedContacts = 0;
  let syncedInvoices = 0;
  let insertedOrUpdated = 0;
  const errors: string[] = [];
  let hasMore = true;
  let resumeOffset: number | null = null;

  while (hasMore) {
    if (Date.now() - startedAt > MAX_RUNTIME_MS) {
      resumeOffset = offset;
      errors.push(`Stopped after ${MAX_RUNTIME_MS}ms; resume from offset ${offset}.`);
      break;
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/axcelerate-finance-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ offset }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      errors.push(`Batch at offset ${offset} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      break;
    }

    const batch = (await res.json()) as SyncBatchResponse;
    if (!batch?.success) {
      errors.push(batch?.message ?? `Batch at offset ${offset} failed.`);
      break;
    }

    batches += 1;
    syncedContacts += batch.syncedContacts ?? 0;
    syncedInvoices += batch.syncedInvoices ?? 0;
    insertedOrUpdated += batch.insertedOrUpdated ?? 0;
    if (batch.errors?.length) errors.push(...batch.errors);

    hasMore = Boolean(batch.hasMore);
    if (hasMore) {
      offset = batch.nextOffset ?? offset + (batch.syncedContacts ?? 0);
      await sleep(BATCH_GAP_MS);
    }
  }

  const completed = !hasMore && resumeOffset == null;

  return jsonResponse({
    success: completed && errors.length === 0,
    completed,
    resumeOffset,
    batches,
    syncedContacts,
    syncedInvoices,
    insertedOrUpdated,
    errors,
    durationMs: Date.now() - startedAt,
  });
});

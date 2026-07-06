// Triggers Render PDF worker — does NOT generate PDFs itself.
// Invoked by: pg_cron (optional), manual POST, or pg_net from DB trigger on instance completion.
// Schedule later (e.g. 12 AM–4 AM AEDT) for batch catch-up.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-pdf-worker-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type TriggerBody = {
  limit?: number;
  role?: string;
  dryRun?: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, message: 'Method not allowed. Use POST.' }, 405);
  }

  const cronSecret = (Deno.env.get('PDF_WORKER_CRON_SECRET') ?? '').trim();
  if (cronSecret) {
    const header = (req.headers.get('x-pdf-worker-cron-secret') ?? '').trim();
    if (header !== cronSecret) {
      return jsonResponse({ ok: false, message: 'Unauthorized.' }, 401);
    }
  }

  let body: TriggerBody = {};
  try {
    body = (await req.json()) as TriggerBody;
  } catch {
    body = {};
  }

  const workerUrl = (Deno.env.get('PDF_WORKER_URL') ?? '').replace(/\/$/, '');
  const workerSecret = (Deno.env.get('PDF_WORKER_SECRET') ?? '').trim();

  if (!workerUrl || !workerSecret) {
    return jsonResponse({ ok: false, message: 'PDF_WORKER_URL and PDF_WORKER_SECRET must be set.' }, 500);
  }

  const payload = {
    limit: Math.min(2, Math.max(1, Number(body.limit ?? 1) || 1)),
    role: String(body.role ?? 'office'),
    dryRun: Boolean(body.dryRun),
  };

  console.log('[trigger-pdf-worker] calling Render', workerUrl, payload);

  const res = await fetch(`${workerUrl}/jobs/process-pdfs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-worker-secret': workerSecret,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }

  console.log('[trigger-pdf-worker] Render response', res.status, parsed);

  return jsonResponse(
    {
      ok: res.ok,
      renderStatus: res.status,
      renderBody: parsed,
    },
    res.ok ? 200 : res.status === 503 ? 503 : 502,
  );
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateInstancePdfBuffer } from './instancePdfGenerator.js';
import { uploadPdfToSharePoint } from './sharepointUpload.js';
import { logMemory } from './pdfMemory.js';

/** Render Free: never process more than one PDF concurrently in this process. */
export const MAX_ACTIVE_WORKER_JOBS = 1;
export const DEFAULT_WORKER_LIMIT = 1;
export const MAX_WORKER_LIMIT = 2;
export const WORKER_JOB_DELAY_MS = 10_000;
export const STALE_LOCK_MINUTES = 30;
export const MAX_RETRY_COUNT = 3;
/** Failed jobs may retry after this delay (ms). */
export const FAILED_RETRY_DELAY_MS = 15 * 60 * 1000;

export type GeneratedPdfRow = {
  id: number;
  instance_id: number;
  role: string;
  pdf_status: string;
  sharepoint_web_url: string | null;
  sharepoint_public_url: string | null;
  sharepoint_drive_item_id: string | null;
  sharepoint_site_id: string | null;
  sharepoint_drive_id: string | null;
  storage_path: string | null;
  retry_count: number;
  last_error: string | null;
  locked_at: string | null;
  locked_by: string | null;
  updated_at?: string | null;
};

export type ProcessPdfJobResult = {
  jobId: number;
  instanceId: number;
  role: string;
  status: 'uploaded' | 'failed' | 'skipped';
  error?: string;
};

export type ProcessPdfsResponse = {
  ok: boolean;
  message?: string;
  picked: number;
  uploaded: number;
  failed: number;
  skipped: number;
  results: ProcessPdfJobResult[];
};

let activeWorkerJobs = 0;
let workerBatchInProgress = false;
const workerInstanceId = `render-${process.pid}-${Date.now()}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 2000);
  return String(err).slice(0, 2000);
}

function isPickableRow(row: GeneratedPdfRow, now: Date): boolean {
  if (row.sharepoint_web_url) return false;
  if (row.pdf_status === 'pending' || row.pdf_status === 'stale') return true;
  if (row.pdf_status === 'failed' && row.retry_count < MAX_RETRY_COUNT) {
    const ts = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    return now.getTime() - ts > FAILED_RETRY_DELAY_MS;
  }
  return false;
}

async function unlockStaleGenerating(supabase: SupabaseClient): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('skyline_generated_pdfs')
    .update({ pdf_status: 'pending', locked_at: null, locked_by: null, last_error: 'Stale lock released' })
    .eq('pdf_status', 'generating')
    .lt('locked_at', staleCutoff);
  if (error) console.warn('[pdf-worker] unlock stale error', error.message);
}

async function lockJob(supabase: SupabaseClient, row: GeneratedPdfRow): Promise<GeneratedPdfRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('skyline_generated_pdfs')
    .update({
      pdf_status: 'generating',
      locked_at: nowIso,
      locked_by: workerInstanceId,
      last_error: null,
    })
    .eq('id', row.id)
    .in('pdf_status', ['pending', 'stale', 'failed'])
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[pdf-worker] lock failed', row.id, error.message);
    return null;
  }
  return (data as GeneratedPdfRow | null) ?? null;
}

async function releaseLock(
  supabase: SupabaseClient,
  jobId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('skyline_generated_pdfs')
    .update({ ...patch, locked_at: null, locked_by: null })
    .eq('id', jobId);
}

async function processOneJob(
  supabase: SupabaseClient,
  row: GeneratedPdfRow,
  role: string,
): Promise<ProcessPdfJobResult> {
  const locked = await lockJob(supabase, row);
  if (!locked) {
    console.log('[pdf-worker] skip already locked', row.id, row.instance_id);
    return { jobId: row.id, instanceId: row.instance_id, role: row.role, status: 'skipped' };
  }

  console.log('[pdf-worker] picked job', locked.id, 'instance', locked.instance_id, 'role', locked.role);
  activeWorkerJobs += 1;

  try {
    const pdfRole = (locked.role === 'trainer' || locked.role === 'student' ? locked.role : 'office') as
      | 'office'
      | 'trainer'
      | 'student';

    const generated = await generateInstancePdfBuffer(supabase, locked.instance_id, pdfRole);
    const uploaded = await uploadPdfToSharePoint(generated.buffer, {
      fileName: generated.fileName,
      unitCode: generated.unitCode,
    });
    const nowIso = new Date().toISOString();

    await releaseLock(supabase, locked.id, {
      pdf_status: 'uploaded',
      sharepoint_web_url: uploaded.webUrl,
      sharepoint_public_url: uploaded.publicUrl,
      sharepoint_drive_item_id: uploaded.driveItemId,
      sharepoint_site_id: uploaded.siteId,
      sharepoint_drive_id: uploaded.driveId,
      storage_path: uploaded.storagePath,
      generated_at: nowIso,
      uploaded_at: nowIso,
      last_error: null,
    });

    console.log('[pdf-worker] uploaded', locked.instance_id, uploaded.storagePath);
    return { jobId: locked.id, instanceId: locked.instance_id, role: locked.role, status: 'uploaded' };
  } catch (err) {
    const msg = summarizeError(err);
    console.error('[pdf-worker] job failed', locked.id, locked.instance_id, msg);
    const nextRetryCount = (locked.retry_count ?? 0) + 1;
    const failedPermanent = nextRetryCount >= MAX_RETRY_COUNT;
    await releaseLock(supabase, locked.id, {
      pdf_status: failedPermanent ? 'failed' : 'pending',
      last_error: msg,
      retry_count: nextRetryCount,
    });
    return {
      jobId: locked.id,
      instanceId: locked.instance_id,
      role: locked.role,
      status: 'failed',
      error: msg,
    };
  } finally {
    activeWorkerJobs = Math.max(0, activeWorkerJobs - 1);
    logMemory(`pdf-worker-job-finally active=${activeWorkerJobs}`);
  }
}

export async function processPdfJobs(
  supabase: SupabaseClient,
  options: { limit?: number; role?: string; dryRun?: boolean } = {},
): Promise<ProcessPdfsResponse> {
  if (workerBatchInProgress || activeWorkerJobs >= MAX_ACTIVE_WORKER_JOBS) {
    console.warn('[pdf-worker] busy — batch or active jobs', { workerBatchInProgress, activeWorkerJobs });
    return {
      ok: false,
      message: 'PDF worker busy, retry later',
      picked: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  workerBatchInProgress = true;
  try {
    return await runPdfJobBatch(supabase, options);
  } finally {
    workerBatchInProgress = false;
  }
}

async function runPdfJobBatch(
  supabase: SupabaseClient,
  options: { limit?: number; role?: string; dryRun?: boolean },
): Promise<ProcessPdfsResponse> {
  const limit = Math.min(MAX_WORKER_LIMIT, Math.max(1, Number(options.limit ?? DEFAULT_WORKER_LIMIT) || DEFAULT_WORKER_LIMIT));
  const roleFilter = String(options.role ?? 'office').trim() || 'office';
  const dryRun = Boolean(options.dryRun);

  const now = new Date();
  await unlockStaleGenerating(supabase);

  const { data: rows, error } = await supabase
    .from('skyline_generated_pdfs')
    .select('*')
    .eq('role', roleFilter)
    .is('sharepoint_web_url', null)
    .in('pdf_status', ['pending', 'stale', 'failed'])
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[pdf-worker] query error', error.message);
    return {
      ok: false,
      message: error.message,
      picked: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  const candidates = ((rows as GeneratedPdfRow[]) ?? []).filter((r) => isPickableRow(r, now));

  const seenInstanceRole = new Set<string>();
  const toProcess: GeneratedPdfRow[] = [];
  for (const row of candidates) {
    const key = `${row.instance_id}:${row.role}`;
    if (seenInstanceRole.has(key)) continue;
    seenInstanceRole.add(key);
    toProcess.push(row);
    if (toProcess.length >= limit) break;
  }
  console.log('[pdf-worker] candidates', candidates.length, 'processing', toProcess.length, 'dryRun', dryRun);

  if (dryRun) {
    return {
      ok: true,
      picked: toProcess.length,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      results: toProcess.map((r) => ({
        jobId: r.id,
        instanceId: r.instance_id,
        role: r.role,
        status: 'skipped' as const,
      })),
    };
  }

  const results: ProcessPdfJobResult[] = [];
  let uploaded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < toProcess.length; i++) {
    if (activeWorkerJobs >= MAX_ACTIVE_WORKER_JOBS) {
      console.warn('[pdf-worker] stopping batch — worker busy');
      break;
    }
    if (i > 0) {
      await sleep(WORKER_JOB_DELAY_MS);
    }
    const result = await processOneJob(supabase, toProcess[i], roleFilter);
    results.push(result);
    if (result.status === 'uploaded') uploaded += 1;
    else if (result.status === 'failed') failed += 1;
    else skipped += 1;
  }

  return {
    ok: true,
    picked: results.length,
    uploaded,
    failed,
    skipped,
    results,
  };
}

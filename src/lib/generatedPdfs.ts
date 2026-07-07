import { supabase } from './supabase';

export type GeneratedPdfStatus = 'pending' | 'generating' | 'uploaded' | 'failed' | 'stale';

export type GeneratedPdfRecord = {
  id: number;
  instance_id: number;
  role: string;
  pdf_status: GeneratedPdfStatus;
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
  generated_at: string | null;
  uploaded_at: string | null;
  last_downloaded_at: string | null;
  download_count: number;
  created_at: string;
  updated_at: string;
};

export function getStoredPdfPreviewUrl(row: GeneratedPdfRecord | null | undefined): string | null {
  if (!row) return null;
  return row.sharepoint_public_url?.trim() || row.sharepoint_web_url?.trim() || null;
}

export type OpenStoredPdfResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_found' | 'no_url' | 'pending' | 'generating' | 'failed' };

export function storedPdfUnavailableMessage(result: Extract<OpenStoredPdfResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not_found':
      return 'PDF not queued yet. Complete the assessment or refresh later.';
    case 'pending':
      return 'PDF is queued for generation. Try again later.';
    case 'generating':
      return 'PDF is being generated. Try again shortly.';
    case 'failed':
      return 'PDF generation failed. Open the assessment to retry.';
    case 'no_url':
      return 'PDF URL is not available yet.';
    default:
      return 'PDF is not available yet.';
  }
}

/** Open stored SharePoint PDF in a new tab and record download. */
export async function openStoredInstancePdf(
  instanceId: number,
  role = 'office',
): Promise<OpenStoredPdfResult> {
  const record = await fetchGeneratedPdf(instanceId, role);
  if (!record) {
    return { ok: false, reason: 'not_found' };
  }
  const url = getStoredPdfPreviewUrl(record);
  if (!url) {
    if (record.pdf_status === 'generating') return { ok: false, reason: 'generating' };
    if (record.pdf_status === 'pending' || record.pdf_status === 'stale') return { ok: false, reason: 'pending' };
    if (record.pdf_status === 'failed') return { ok: false, reason: 'failed' };
    return { ok: false, reason: 'no_url' };
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  await recordGeneratedPdfDownload(record.id);
  return { ok: true, url };
}

export function buildLiveInstancePdfDownloadUrl(instanceId: number, role = 'office'): string | null {
  const base = String(import.meta.env.VITE_PDF_API_URL ?? '').replace(/\/$/, '');
  if (!base || !Number.isFinite(instanceId) || instanceId <= 0) return null;
  const params = new URLSearchParams({
    role,
    download: '1',
    t: String(Date.now()),
  });
  return `${base}/pdf/${instanceId}?${params.toString()}`;
}

/** Embedded / inline preview via pdf-server (SharePoint blocks iframe embedding). */
export function buildLiveInstancePdfPreviewUrl(instanceId: number, role = 'office'): string | null {
  const base = String(import.meta.env.VITE_PDF_API_URL ?? '').replace(/\/$/, '');
  if (!base || !Number.isFinite(instanceId) || instanceId <= 0) return null;
  const params = new URLSearchParams({
    role,
    t: String(Date.now()),
  });
  return `${base}/pdf/${instanceId}?${params.toString()}#toolbar=0`;
}

export const LIVE_PDF_GENERATE_CONFIRM_MESSAGE =
  'This PDF is not in SharePoint yet. Generate and download it now? This uses the PDF server directly and may take up to 2 minutes.';

export type InstancePdfDownloadOutcome = 'sharepoint' | 'live' | 'cancelled' | 'unavailable';

/**
 * Prefer SharePoint stored PDF. If missing, optionally prompt then open live Render PDF download.
 */
export async function requestInstancePdfDownload(
  instanceId: number,
  role = 'office',
  options?: {
    confirmLiveGenerate?: () => boolean | Promise<boolean>;
  },
): Promise<{ outcome: InstancePdfDownloadOutcome; message?: string }> {
  const stored = await openStoredInstancePdf(instanceId, role);
  if (stored.ok) return { outcome: 'sharepoint' };

  const liveUrl = buildLiveInstancePdfDownloadUrl(instanceId, role);
  if (!liveUrl) {
    return { outcome: 'unavailable', message: storedPdfUnavailableMessage(stored) };
  }

  const confirm = options?.confirmLiveGenerate;
  if (!confirm) {
    return { outcome: 'unavailable', message: 'Live PDF confirmation is required.' };
  }
  const approved = await confirm();
  if (!approved) return { outcome: 'cancelled' };

  window.open(liveUrl, '_blank', 'noopener,noreferrer');
  return { outcome: 'live' };
}

export async function fetchGeneratedPdf(
  instanceId: number,
  role: string,
): Promise<GeneratedPdfRecord | null> {
  if (!Number.isFinite(instanceId) || instanceId <= 0) return null;
  const { data, error } = await supabase
    .from('skyline_generated_pdfs')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('role', role)
    .maybeSingle();
  if (error) {
    console.error('fetchGeneratedPdf', error.message);
    return null;
  }
  return (data as GeneratedPdfRecord | null) ?? null;
}

/** Queue a completed instance for background PDF generation (upsert). Fallback if DB trigger did not run. */
export async function queueGeneratedPdf(instanceId: number, role: string): Promise<GeneratedPdfRecord | null> {
  const existing = await fetchGeneratedPdf(instanceId, role);
  if (existing?.sharepoint_web_url?.trim() || existing?.sharepoint_public_url?.trim()) {
    return existing;
  }
  if (existing?.pdf_status === 'uploaded') {
    return existing;
  }

  const { data, error } = await supabase
    .from('skyline_generated_pdfs')
    .upsert(
      {
        instance_id: instanceId,
        role,
        pdf_status: 'pending',
        last_error: null,
      },
      { onConflict: 'instance_id,role' },
    )
    .select('*')
    .single();
  if (error) {
    console.error('queueGeneratedPdf', error.message);
    return null;
  }
  return data as GeneratedPdfRecord;
}

/**
 * Request regeneration — marks stale while keeping existing SharePoint URL until new upload succeeds.
 */
export async function requestRegeneratePdf(instanceId: number, role: string): Promise<GeneratedPdfRecord | null> {
  const { data, error } = await supabase
    .from('skyline_generated_pdfs')
    .upsert(
      {
        instance_id: instanceId,
        role,
        pdf_status: 'stale',
        retry_count: 0,
        last_error: null,
        locked_at: null,
        locked_by: null,
      },
      { onConflict: 'instance_id,role' },
    )
    .select('*')
    .single();
  if (error) {
    console.error('requestRegeneratePdf', error.message);
    return null;
  }
  return data as GeneratedPdfRecord;
}

/** Retry after failure — back to pending, keep prior URL until replaced. */
export async function retryFailedGeneratedPdf(instanceId: number, role: string): Promise<GeneratedPdfRecord | null> {
  const { data, error } = await supabase
    .from('skyline_generated_pdfs')
    .update({
      pdf_status: 'pending',
      retry_count: 0,
      last_error: null,
      locked_at: null,
      locked_by: null,
    })
    .eq('instance_id', instanceId)
    .eq('role', role)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('retryFailedGeneratedPdf', error.message);
    return null;
  }
  return (data as GeneratedPdfRecord | null) ?? null;
}

export async function recordGeneratedPdfDownload(rowId: number): Promise<void> {
  const { data: row } = await supabase.from('skyline_generated_pdfs').select('download_count').eq('id', rowId).maybeSingle();
  const next = (Number((row as { download_count?: number } | null)?.download_count ?? 0) || 0) + 1;
  const { error } = await supabase
    .from('skyline_generated_pdfs')
    .update({ download_count: next, last_downloaded_at: new Date().toISOString() })
    .eq('id', rowId);
  if (error) console.error('recordGeneratedPdfDownload', error.message);
}

/** Instance is ready for background PDF queue when locked and workflow completed. */
export function isInstanceCompletedForPdfQueue(
  workflowStatus: string | null | undefined,
  legacyStatus?: string | null,
): boolean {
  const ws = String(workflowStatus ?? '').trim();
  const st = String(legacyStatus ?? '').trim();
  return st === 'locked' && ws === 'completed';
}

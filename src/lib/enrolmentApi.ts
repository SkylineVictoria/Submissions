import { mergeEnrolmentPayload } from './enrolmentDefaults';
import { supabase } from './supabase';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../types/enrolment';

export type EnrolmentDraftLoadResult =
  | { ok: true; status: string; applicationNo: string | null; values: EnrolmentFormValues; files: EnrolmentFileRef[] }
  | { ok: false; error?: string };

const MIGRATION_HINT =
  'Enrolment database functions are missing. Run supabase/scripts/apply_student_enrolment.sql in the Supabase SQL Editor, then retry.';

function rpcErrorMessage(error: { message?: string; code?: string }): string {
  const msg = error.message ?? 'Request failed';
  if (
    msg.includes('schema cache') ||
    msg.includes('Could not find the function') ||
    error.code === 'PGRST202'
  ) {
    return MIGRATION_HINT;
  }
  return msg;
}

export async function createEnrolmentDraft(): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase.rpc('skyline_student_enrolment_create_draft', {});
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  const row = data as { ok?: boolean; id?: string; error?: string };
  if (!row?.ok || !row.id) return { ok: false, error: row?.error ?? 'Could not create draft' };
  return { ok: true, id: String(row.id) };
}

function rowFromForm(values: EnrolmentFormValues) {
  return {
    p_first_name: values.personal.firstName,
    p_middle_name: values.personal.middleName,
    p_last_name: values.personal.lastName,
    p_email: values.personal.email,
    p_phone_mobile: values.personal.mobile,
    p_payload: values as unknown as Record<string, unknown>,
  };
}

export async function loadEnrolmentDraft(id: string): Promise<EnrolmentDraftLoadResult> {
  const { data, error } = await supabase.rpc('skyline_student_enrolment_get_draft', { p_id: id });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  const row = data as {
    ok?: boolean;
    error?: string;
    status?: string;
    application_no?: string | null;
    payload?: unknown;
    files?: EnrolmentFileRef[];
  };
  if (!row?.ok) return { ok: false, error: row?.error ?? 'Could not load draft' };
  return {
    ok: true,
    status: row.status ?? 'draft',
    applicationNo: row.application_no ?? null,
    values: mergeEnrolmentPayload(row.payload),
    files: Array.isArray(row.files) ? row.files : [],
  };
}

export async function saveEnrolmentDraft(
  id: string,
  values: EnrolmentFormValues,
  files: EnrolmentFileRef[]
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('skyline_student_enrolment_save_draft', {
    p_id: id,
    ...rowFromForm(values),
    p_files: files,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { ok: false, error: row?.error ?? 'Save failed' };
  return { ok: true };
}

export async function submitEnrolmentApplication(
  id: string,
  values: EnrolmentFormValues,
  files: EnrolmentFileRef[],
  agentCopySent: boolean
): Promise<{ ok: boolean; applicationNo?: string; error?: string }> {
  const { data, error } = await supabase.rpc('skyline_student_enrolment_submit', {
    p_id: id,
    ...rowFromForm(values),
    p_files: files,
    p_agent_copy_sent: agentCopySent,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  const row = data as { ok?: boolean; application_no?: string; error?: string };
  if (!row?.ok) return { ok: false, error: row?.error ?? 'Submit failed' };
  return { ok: true, applicationNo: row.application_no };
}

/** Placeholder — wire to edge function / Resend when available. */
export async function sendEnrolmentCopyToAgent(
  applicationId: string,
  agentEmail: string
): Promise<{ ok: boolean; error?: string }> {
  console.info('sendEnrolmentCopyToAgent placeholder', { applicationId, agentEmail });
  return { ok: true };
}

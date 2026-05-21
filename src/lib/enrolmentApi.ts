import { mergeEnrolmentPayload } from './enrolmentDefaults';
import { supabase } from './supabase';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../types/enrolment';

export type EnrolmentDraftLoadResult =
  | { ok: true; status: string; applicationNo: string | null; values: EnrolmentFormValues; files: EnrolmentFileRef[] }
  | { ok: false; error?: string };

const MIGRATION_HINT =
  'Enrolment database functions are missing on this project. Run `supabase db push` (or apply supabase/migrations/20260514130000_student_enrolment_get_draft.sql and later enrolment migrations in the SQL Editor), then retry.';

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

/** Returns existing draft id for this email, if any. */
export async function findEnrolmentDraftByEmail(
  email: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const trimmed = email.trim();
  if (!trimmed) return { ok: false, error: 'missing_email' };
  const { data, error } = await supabase.rpc('skyline_student_enrolment_find_draft_by_email', {
    p_email: trimmed,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  const row = data as { ok?: boolean; id?: string; error?: string };
  if (!row?.ok || !row.id) return { ok: false, error: row?.error ?? 'not_found' };
  return { ok: true, id: String(row.id) };
}

/** Upserts one draft per email, or updates the session draft when email is not entered yet. */
export async function createEnrolmentDraft(
  values: EnrolmentFormValues,
  files: EnrolmentFileRef[] = [],
  existingId?: string | null
): Promise<{ ok: boolean; id?: string; updated?: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('skyline_student_enrolment_create_draft', {
    ...rowFromForm(values),
    p_files: files,
    p_existing_id: existingId ?? null,
  });
  if (error) return { ok: false, error: rpcErrorMessage(error) };
  const row = data as { ok?: boolean; id?: string; updated?: boolean; error?: string };
  if (!row?.ok || !row.id) return { ok: false, error: row?.error ?? 'Could not create draft' };
  return { ok: true, id: String(row.id), updated: Boolean(row.updated) };
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

export type SendEnrolmentEmailsInput = {
  applicationId: string;
  applicationNo: string | null;
  applicantEmail: string;
  applicantName: string;
  agentEmail?: string;
  sendToAgent: boolean;
  pdfBase64: string;
  pdfFilename: string;
  fileRefs: EnrolmentFileRef[];
};

export async function sendEnrolmentSubmissionEmails(
  input: SendEnrolmentEmailsInput
): Promise<{ ok: boolean; agentSent?: boolean; message?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('skyline-send-enrolment-email', {
      body: {
        applicationId: input.applicationId,
        applicationNo: input.applicationNo,
        applicantEmail: input.applicantEmail.trim(),
        applicantName: input.applicantName.trim(),
        agentEmail: input.sendToAgent ? input.agentEmail?.trim() : undefined,
        sendToAgent: input.sendToAgent,
        pdfBase64: input.pdfBase64,
        pdfFilename: input.pdfFilename,
        fileRefs: input.fileRefs.map((f) => ({
          path: f.path,
          name: f.name,
          mimeType: f.mimeType,
          section: f.section,
          field: f.field,
        })),
      },
    });

    if (error) {
      return { ok: false, error: error.message || 'Could not send enrolment email.' };
    }

    const row = data as {
      success?: boolean;
      message?: string;
      agentSent?: boolean;
    } | null;

    if (!row?.success) {
      return { ok: false, error: row?.message ?? 'Could not send enrolment email.' };
    }

    return { ok: true, agentSent: row.agentSent, message: row.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send enrolment email.' };
  }
}

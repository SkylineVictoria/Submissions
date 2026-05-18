import { mergeEnrolmentPayload } from './enrolmentDefaults';
import { supabase } from './supabase';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../types/enrolment';

export interface EnrolmentApplicationListRow {
  id: string;
  application_no: string | null;
  status: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  submitted_at: string | null;
  created_at: string;
  payload: EnrolmentFormValues;
  files: EnrolmentFileRef[];
}

export function displayEnrolmentName(row: EnrolmentApplicationListRow): string {
  return [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(' ') || '—';
}

export async function listEnrolmentApplications(filters: {
  name?: string;
  from?: string;
  to?: string;
  status?: string;
}): Promise<{ ok: boolean; rows?: EnrolmentApplicationListRow[]; error?: string }> {
  const { data, error } = await supabase.rpc('skyline_student_enrolment_list', {
    p_name: filters.name?.trim() || null,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_status: filters.status?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  const raw = (data ?? []) as unknown[];
  if (!Array.isArray(raw)) return { ok: true, rows: [] };
  const rows: EnrolmentApplicationListRow[] = raw.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      id: String(o.id ?? ''),
      application_no: (o.application_no as string | null) ?? null,
      status: String(o.status ?? ''),
      first_name: (o.first_name as string | null) ?? null,
      middle_name: (o.middle_name as string | null) ?? null,
      last_name: (o.last_name as string | null) ?? null,
      email: (o.email as string | null) ?? null,
      phone_mobile: (o.phone_mobile as string | null) ?? null,
      submitted_at: (o.submitted_at as string | null) ?? null,
      created_at: String(o.created_at ?? ''),
      payload: mergeEnrolmentPayload(o.payload),
      files: Array.isArray(o.files) ? (o.files as EnrolmentFileRef[]) : [],
    };
  });
  return { ok: true, rows };
}

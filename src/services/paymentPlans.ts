import { canManagePaymentPlans, getEffectiveStoredUser } from '../lib/formEngine';
import { supabase } from '../lib/supabase';
import type {
  AssignInstallmentInput,
  PaymentPeriod,
  PaymentPlanFormValues,
  PaymentPlanSummary,
  PaymentPlanTemplateInstallment,
  PaymentReceipt,
  StudentPaymentPlanInstallment,
  StudentPaymentPlanSummary,
  StudentPaymentPlanInstallmentTransaction,
} from '../types/paymentPlans';
import { parseAmountInput, pickerToIsoDate } from '../lib/paymentPlanCalculations';

function mapPeriod(value: unknown): PaymentPeriod {
  const v = String(value ?? 'monthly');
  if (v === 'weekly' || v === 'fortnightly' || v === 'monthly' || v === 'custom') return v;
  return 'monthly';
}

function mapPlanSummary(row: Record<string, unknown>): PaymentPlanSummary {
  return {
    id: Number(row.id),
    plan_name: String(row.plan_name ?? ''),
    total_amount: Number(row.total_amount ?? 0),
    currency: String(row.currency ?? 'AUD'),
    installment_count: Number(row.installment_count ?? 0),
    start_date: String(row.start_date ?? ''),
    calculation_mode: row.calculation_mode as PaymentPlanSummary['calculation_mode'],
    payment_period: mapPeriod(row.payment_period),
    regular_monthly_amount:
      row.regular_monthly_amount != null ? Number(row.regular_monthly_amount) : null,
    notes: row.notes != null ? String(row.notes) : null,
    status: row.status as PaymentPlanSummary['status'],
    confirmed_at: row.confirmed_at != null ? String(row.confirmed_at) : null,
    confirmed_by: row.confirmed_by != null ? Number(row.confirmed_by) : null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    assigned_student_count: Number(row.assigned_student_count ?? 0),
    installment_row_count: Number(row.installment_row_count ?? 0),
    installment_total: Number(row.installment_total ?? 0),
    total_paid: Number(row.total_paid ?? 0),
    paid_count: Number(row.paid_count ?? 0),
    pending_count: Number(row.pending_count ?? 0),
  };
}

function mapStudentAssignment(row: Record<string, unknown>): StudentPaymentPlanSummary {
  return {
    assignment_id: Number(row.assignment_id),
    payment_plan_id: Number(row.payment_plan_id),
    student_id: Number(row.student_id),
    assignment_start_date: String(row.assignment_start_date ?? ''),
    assignment_status: row.assignment_status as StudentPaymentPlanSummary['assignment_status'],
    assigned_at: String(row.assigned_at ?? ''),
    assigned_by: row.assigned_by != null ? Number(row.assigned_by) : null,
    template_total_amount:
      row.template_total_amount != null ? Number(row.template_total_amount) : null,
    assigned_total_amount:
      row.assigned_total_amount != null ? Number(row.assigned_total_amount) : null,
    adjustment_amount: Number(row.adjustment_amount ?? 0),
    adjustment_reason: row.adjustment_reason != null ? String(row.adjustment_reason) : null,
    payment_period: mapPeriod(row.payment_period),
    is_finalized: row.is_finalized !== false,
    finalized_at: row.finalized_at != null ? String(row.finalized_at) : null,
    plan_name: String(row.plan_name ?? ''),
    total_amount: Number(row.total_amount ?? 0),
    template_plan_total:
      row.template_plan_total != null ? Number(row.template_plan_total) : null,
    currency: String(row.currency ?? 'AUD'),
    installment_count: Number(row.installment_count ?? 0),
    template_installment_count:
      row.template_installment_count != null ? Number(row.template_installment_count) : null,
    calculation_mode: row.calculation_mode as StudentPaymentPlanSummary['calculation_mode'],
    template_payment_period:
      row.template_payment_period != null ? mapPeriod(row.template_payment_period) : null,
    plan_status: row.plan_status as StudentPaymentPlanSummary['plan_status'],
    display_student_name: row.display_student_name != null ? String(row.display_student_name) : null,
    display_student_email:
      row.display_student_email != null ? String(row.display_student_email) : null,
    installment_row_count: Number(row.installment_row_count ?? 0),
    installment_total: Number(row.installment_total ?? 0),
    total_paid: Number(row.total_paid ?? 0),
    total_waived: Number(row.total_waived ?? 0),
    paid_count: Number(row.paid_count ?? 0),
    pending_count: Number(row.pending_count ?? 0),
  };
}

function mapTemplateInstallment(row: Record<string, unknown>): PaymentPlanTemplateInstallment {
  return {
    id: Number(row.id),
    payment_plan_id: Number(row.payment_plan_id),
    installment_number: Number(row.installment_number),
    due_date: String(row.due_date ?? ''),
    amount: Number(row.amount ?? 0),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function mapStudentInstallment(row: Record<string, unknown>): StudentPaymentPlanInstallment {
  return {
    id: Number(row.id),
    student_payment_plan_id: Number(row.student_payment_plan_id),
    installment_number: Number(row.installment_number),
    due_date: String(row.due_date ?? ''),
    amount: Number(row.amount ?? 0),
    status: row.status as StudentPaymentPlanInstallment['status'],
    paid_amount: Number(row.paid_amount ?? 0),
    payment_date: row.payment_date != null ? String(row.payment_date) : null,
    notes: row.notes != null ? String(row.notes) : null,
    waived_amount: Number(row.waived_amount ?? 0),
    waiver_reason: row.waiver_reason != null ? String(row.waiver_reason) : null,
    payment_reference: row.payment_reference != null ? String(row.payment_reference) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

function buildPlanPayload(values: PaymentPlanFormValues, createdBy?: number) {
  const total = parseAmountInput(values.total_amount);
  if (total == null || total <= 0) throw new Error('Total amount must be greater than zero.');

  const count = Number.parseInt(values.installment_count, 10);
  if (!Number.isFinite(count) || count < 1) throw new Error('Installment count must be at least 1.');

  const startDate = pickerToIsoDate(values.start_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Start date is required.');

  const regular =
    values.calculation_mode === 'uneven' ? parseAmountInput(values.regular_monthly_amount) : null;

  return {
    plan_name: values.plan_name.trim(),
    total_amount: total,
    currency: values.currency.trim() || 'AUD',
    installment_count: count,
    start_date: startDate,
    calculation_mode: values.calculation_mode,
    payment_period: values.payment_period || 'monthly',
    regular_monthly_amount: regular,
    notes: values.notes.trim() || null,
    ...(createdBy != null ? { created_by: createdBy } : {}),
  };
}

export async function listPaymentPlanSummaries(): Promise<PaymentPlanSummary[]> {
  const { data, error } = await supabase
    .from('skyline_payment_plan_summary')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapPlanSummary(row as Record<string, unknown>));
}

export async function listStudentPaymentPlansForStudent(
  studentId: number
): Promise<StudentPaymentPlanSummary[]> {
  const { data, error } = await supabase
    .from('skyline_student_payment_plan_summary')
    .select('*')
    .eq('student_id', studentId)
    .eq('assignment_status', 'active')
    .order('assigned_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapStudentAssignment(row as Record<string, unknown>));
}

export async function listStudentPaymentPlansForPlan(
  planId: number
): Promise<StudentPaymentPlanSummary[]> {
  const { data, error } = await supabase
    .from('skyline_student_payment_plan_summary')
    .select('*')
    .eq('payment_plan_id', planId)
    .eq('assignment_status', 'active')
    .order('display_student_name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapStudentAssignment(row as Record<string, unknown>));
}

export async function fetchTemplateInstallments(
  planId: number
): Promise<PaymentPlanTemplateInstallment[]> {
  const { data, error } = await supabase
    .from('skyline_payment_plan_installments')
    .select('*')
    .eq('payment_plan_id', planId)
    .order('installment_number', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapTemplateInstallment(row as Record<string, unknown>));
}

export async function fetchStudentAssignmentInstallments(
  assignmentId: number
): Promise<StudentPaymentPlanInstallment[]> {
  const { data, error } = await supabase
    .from('skyline_student_payment_plan_installments')
    .select('*')
    .eq('student_payment_plan_id', assignmentId)
    .order('installment_number', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapStudentInstallment(row as Record<string, unknown>));
}

export async function createPaymentPlan(
  values: PaymentPlanFormValues,
  createdBy: number
): Promise<number> {
  const payload = buildPlanPayload(values, createdBy);
  if (!payload.plan_name) throw new Error('Plan name is required.');

  const { data, error } = await supabase
    .from('skyline_payment_plans')
    .insert(payload)
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return Number(data.id);
}

export async function updatePaymentPlan(planId: number, values: PaymentPlanFormValues): Promise<void> {
  const payload = buildPlanPayload(values);
  if (!payload.plan_name) throw new Error('Plan name is required.');

  const { error } = await supabase.from('skyline_payment_plans').update(payload).eq('id', planId);
  if (error) throw new Error(error.message);
}

export async function generatePaymentPlanInstallments(
  planId: number,
  regularMonthlyAmount?: number | null
): Promise<void> {
  const { error } = await supabase.rpc('skyline_generate_payment_plan_installments', {
    p_plan_id: planId,
    p_regular_monthly_amount: regularMonthlyAmount ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function confirmPaymentPlan(planId: number, confirmedBy: number): Promise<void> {
  const { error } = await supabase.rpc('skyline_confirm_payment_plan', {
    p_plan_id: planId,
    p_confirmed_by: confirmedBy,
  });
  if (error) throw new Error(error.message);
}

export async function assignPaymentPlanToStudent(
  planId: number,
  studentId: number,
  assignedBy: number,
  startDate?: string | null
): Promise<number> {
  const { data, error } = await supabase.rpc('skyline_assign_payment_plan_student', {
    p_plan_id: planId,
    p_student_id: studentId,
    p_start_date: startDate ? pickerToIsoDate(startDate) : null,
    p_assigned_by: assignedBy,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

export interface AssignPaymentPlanOptions {
  assignedTotalAmount: number;
  adjustmentReason?: string | null;
  paymentPeriod: PaymentPeriod;
  installmentCount: number;
}

export async function assignPaymentPlanWithInstallments(
  planId: number,
  studentId: number,
  assignedBy: number,
  startDate: string,
  installments: AssignInstallmentInput[],
  options: AssignPaymentPlanOptions
): Promise<number> {
  const { data, error } = await supabase.rpc('skyline_assign_payment_plan_student_with_installments', {
    p_plan_id: planId,
    p_student_id: studentId,
    p_start_date: pickerToIsoDate(startDate),
    p_assigned_by: assignedBy,
    p_installments: installments,
    p_assigned_total_amount: options.assignedTotalAmount,
    p_adjustment_reason: options.adjustmentReason ?? null,
    p_payment_period: options.paymentPeriod,
    p_installment_count: options.installmentCount,
  });
  if (error) throw new Error(error.message);
  return Number(data);
}

export async function unassignPaymentPlanFromStudent(
  planId: number,
  studentId: number
): Promise<void> {
  const { error } = await supabase.rpc('skyline_unassign_payment_plan_student', {
    p_plan_id: planId,
    p_student_id: studentId,
  });
  if (error) throw new Error(error.message);
}

export async function saveCustomTemplateInstallments(
  planId: number,
  rows: Array<{ installment_number: number; due_date: string; amount: number }>
): Promise<void> {
  const { error: delErr } = await supabase
    .from('skyline_payment_plan_installments')
    .delete()
    .eq('payment_plan_id', planId);
  if (delErr) throw new Error(delErr.message);

  if (rows.length === 0) return;

  const payload = rows.map((r) => ({
    payment_plan_id: planId,
    installment_number: r.installment_number,
    due_date: pickerToIsoDate(r.due_date),
    amount: r.amount,
  }));

  const { error } = await supabase.from('skyline_payment_plan_installments').insert(payload);
  if (error) throw new Error(error.message);

  const { data: assignments } = await supabase
    .from('skyline_student_payment_plans')
    .select('id')
    .eq('payment_plan_id', planId)
    .eq('status', 'active');

  for (const a of assignments ?? []) {
    await supabase.rpc('skyline_copy_payment_plan_installments_to_student', {
      p_student_payment_plan_id: Number((a as { id: number }).id),
    });
  }
}

export async function updateTemplateInstallmentRow(
  installmentId: number,
  patch: Pick<PaymentPlanTemplateInstallment, 'due_date' | 'amount'>
): Promise<void> {
  const { error } = await supabase
    .from('skyline_payment_plan_installments')
    .update({
      due_date: pickerToIsoDate(patch.due_date),
      amount: patch.amount,
    })
    .eq('id', installmentId);
  if (error) throw new Error(error.message);
}

export async function updateStudentInstallmentPaymentFields(
  installmentId: number,
  patch: Pick<
    StudentPaymentPlanInstallment,
    'status' | 'paid_amount' | 'payment_date' | 'notes' | 'waived_amount' | 'waiver_reason' | 'payment_reference'
  >,
  changedBy?: number
): Promise<void> {
  const { error } = await supabase.rpc('skyline_update_student_installment_payment', {
    p_installment_id: installmentId,
    p_status: patch.status,
    p_paid_amount: patch.paid_amount,
    p_payment_date: patch.payment_date ? pickerToIsoDate(patch.payment_date) : null,
    p_notes: patch.notes,
    p_waived_amount: patch.waived_amount ?? 0,
    p_waiver_reason: patch.waiver_reason ?? null,
    p_payment_reference: patch.payment_reference ?? null,
    p_changed_by: changedBy ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function reorderPendingStudentInstallments(
  assignmentId: number,
  orderedInstallmentIds: number[],
  changedBy?: number
): Promise<void> {
  const { error } = await supabase.rpc('skyline_reorder_pending_student_installments', {
    p_assignment_id: assignmentId,
    p_ordered_installment_ids: orderedInstallmentIds,
    p_changed_by: changedBy ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function updateDraftStudentInstallmentRow(
  installmentId: number,
  patch: Pick<StudentPaymentPlanInstallment, 'due_date' | 'amount' | 'notes'>
): Promise<void> {
  const { error } = await supabase
    .from('skyline_student_payment_plan_installments')
    .update({
      due_date: pickerToIsoDate(patch.due_date),
      amount: patch.amount,
      notes: patch.notes,
    })
    .eq('id', installmentId);
  if (error) throw new Error(error.message);
}

/** @deprecated Use fetchTemplateInstallments */
export const fetchPaymentPlanInstallments = fetchTemplateInstallments;

// ---------------------------------------------------------------------------
// Payment receipt listing/upload (SharePoint via Edge Function)
// ---------------------------------------------------------------------------

function mapPaymentTransactionRow(row: Record<string, unknown>): StudentPaymentPlanInstallmentTransaction {
  return {
    id: Number(row.id),
    installment_id: Number(row.installment_id),
    student_payment_plan_id: Number(row.student_payment_plan_id),
    student_id: Number(row.student_id),
    amount: Number(row.amount ?? 0),
    status: row.status as StudentPaymentPlanInstallmentTransaction['status'],
    payment_date: row.payment_date != null ? String(row.payment_date) : null,
    payment_reference: row.payment_reference != null ? String(row.payment_reference) : null,
    notes: row.notes != null ? String(row.notes) : null,
    waived_amount: Number(row.waived_amount ?? 0),
    waiver_reason: row.waiver_reason != null ? String(row.waiver_reason) : null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: String(row.created_at ?? ''),
  };
}

function mapPaymentReceiptRow(row: Record<string, unknown>): PaymentReceipt {
  return {
    id: Number(row.id),
    payment_transaction_id: Number(row.payment_transaction_id),
    student_id: Number(row.student_id),
    sharepoint_item_id: String(row.sharepoint_item_id ?? ''),
    sharepoint_drive_id: String(row.sharepoint_drive_id ?? ''),
    sharepoint_site_id: String(row.sharepoint_site_id ?? ''),
    file_name: String(row.file_name ?? ''),
    original_file_name: String(row.original_file_name ?? ''),
    mime_type: String(row.mime_type ?? ''),
    file_size: Number(row.file_size ?? 0),
    web_url: String(row.web_url ?? ''),
    sharepoint_path: String(row.sharepoint_path ?? ''),
    uploaded_by: row.uploaded_by != null ? Number(row.uploaded_by) : null,
    uploaded_at: String(row.uploaded_at ?? ''),
    is_active: Boolean(row.is_active),
  };
}

export async function fetchPaymentTransactionsForInstallments(
  installmentIds: number[]
): Promise<StudentPaymentPlanInstallmentTransaction[]> {
  const ids = installmentIds.filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('skyline_student_payment_transactions')
    .select('*')
    .in('installment_id', ids)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapPaymentTransactionRow(r as Record<string, unknown>));
}

export async function fetchActivePaymentReceiptsForTransactions(
  paymentTransactionIds: number[]
): Promise<PaymentReceipt[]> {
  const ids = paymentTransactionIds.filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('skyline_payment_receipts')
    .select('*')
    .in('payment_transaction_id', ids)
    .eq('is_active', true);

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapPaymentReceiptRow(r as Record<string, unknown>));
}

export type UploadPaymentReceiptResult =
  | { success: true; receipt: PaymentReceipt & { webUrl: string; originalFileName: string; fileName: string; uploadedAt: string } }
  | { success: false; code: string; message: string };

function mapUploadReceiptResponse(
  receipt: Record<string, unknown>,
  args: { paymentTransactionId: number; studentId: number; file: File; uploadedBy: number }
): Extract<UploadPaymentReceiptResult, { success: true }> {
  return {
    success: true,
    receipt: {
      id: Number(receipt.id),
      payment_transaction_id: Number(args.paymentTransactionId),
      student_id: Number(args.studentId),
      sharepoint_item_id: String(receipt.sharepoint_item_id ?? ''),
      sharepoint_drive_id: String(receipt.sharepoint_drive_id ?? ''),
      sharepoint_site_id: String(receipt.sharepoint_site_id ?? ''),
      file_name: String(receipt.fileName ?? receipt.file_name ?? ''),
      original_file_name: String(receipt.originalFileName ?? receipt.original_file_name ?? ''),
      mime_type: String(receipt.mimeType ?? receipt.mime_type ?? args.file.type),
      file_size: Number(receipt.fileSize ?? receipt.file_size ?? args.file.size ?? 0),
      web_url: String(receipt.webUrl ?? receipt.web_url ?? ''),
      sharepoint_path: String(receipt.sharepointPath ?? receipt.sharepoint_path ?? ''),
      uploaded_by: args.uploadedBy,
      uploaded_at: String(receipt.uploadedAt ?? receipt.uploaded_at ?? ''),
      is_active: true,
      webUrl: String(receipt.webUrl ?? receipt.web_url ?? ''),
      originalFileName: String(receipt.originalFileName ?? receipt.original_file_name ?? ''),
      fileName: String(receipt.fileName ?? receipt.file_name ?? ''),
      uploadedAt: String(receipt.uploadedAt ?? receipt.uploaded_at ?? ''),
    },
  };
}

type UploadReceiptInvokeResponse = {
  success?: boolean;
  code?: string;
  message?: string;
  receipt?: Record<string, unknown>;
};

/** Staff auth is skyline_users in localStorage (OTP login), not Supabase Auth sessions. */
export async function uploadPaymentReceipt(args: {
  file: File;
  paymentTransactionId: number;
  studentId: number;
  replaceExistingReceipt?: boolean;
}): Promise<UploadPaymentReceiptResult> {
  const staffUser = getEffectiveStoredUser();
  if (!staffUser?.id || !canManagePaymentPlans(staffUser)) {
    return { success: false, code: 'AUTH_REQUIRED', message: 'Authentication required.' };
  }

  if (!Number.isFinite(args.paymentTransactionId) || args.paymentTransactionId <= 0) {
    return { success: false, code: 'PAYMENT_NOT_FOUND', message: 'Payment transaction not found.' };
  }

  const formData = new FormData();
  formData.append('file', args.file);
  formData.append('paymentTransactionId', String(args.paymentTransactionId));
  formData.append('studentId', String(args.studentId));
  formData.append('staffUserId', String(staffUser.id));
  formData.append('replaceExistingReceipt', String(Boolean(args.replaceExistingReceipt)));

  let json: UploadReceiptInvokeResponse | null = null;

  const { data, error } = await supabase.functions.invoke('skyline-upload-payment-receipt', {
    body: formData,
  });

  if (!error && data && typeof data === 'object') {
    json = data as UploadReceiptInvokeResponse;
  } else {
    // File uploads require multipart; fall back to direct fetch when invoke cannot send FormData.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!supabaseUrl || !anonKey) {
      return { success: false, code: 'UPLOAD_FAILED', message: 'App is not configured.' };
    }

    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/skyline-upload-payment-receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      body: formData,
    });
    json = (await res.json().catch(() => ({}))) as UploadReceiptInvokeResponse;
    if (!res.ok && json?.success !== false) {
      return { success: false, code: 'UPLOAD_FAILED', message: error?.message || 'Upload failed.' };
    }
  }

  if (json?.success === false) {
    return {
      success: false,
      code: json.code ?? 'UPLOAD_FAILED',
      message: json.message ?? 'Upload failed.',
    };
  }

  const receipt = json?.receipt;
  if (!receipt || typeof receipt !== 'object') {
    const message = error?.message || 'Upload failed.';
    if (/jwt|auth|unauthorized|401/i.test(message)) {
      return { success: false, code: 'AUTH_REQUIRED', message: 'Authentication required.' };
    }
    return { success: false, code: 'UPLOAD_FAILED', message };
  }

  return mapUploadReceiptResponse(receipt, {
    paymentTransactionId: args.paymentTransactionId,
    studentId: args.studentId,
    file: args.file,
    uploadedBy: staffUser.id,
  });
}

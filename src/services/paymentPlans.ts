import { supabase } from '../lib/supabase';
import type {
  AssignInstallmentInput,
  PaymentPlanFormValues,
  PaymentPlanSummary,
  PaymentPlanTemplateInstallment,
  StudentPaymentPlanInstallment,
  StudentPaymentPlanSummary,
} from '../types/paymentPlans';
import { parseAmountInput, pickerToIsoDate } from '../lib/paymentPlanCalculations';

function mapPlanSummary(row: Record<string, unknown>): PaymentPlanSummary {
  return {
    id: Number(row.id),
    plan_name: String(row.plan_name ?? ''),
    total_amount: Number(row.total_amount ?? 0),
    currency: String(row.currency ?? 'AUD'),
    installment_count: Number(row.installment_count ?? 0),
    start_date: String(row.start_date ?? ''),
    calculation_mode: row.calculation_mode as PaymentPlanSummary['calculation_mode'],
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
    plan_name: String(row.plan_name ?? ''),
    total_amount: Number(row.total_amount ?? 0),
    currency: String(row.currency ?? 'AUD'),
    installment_count: Number(row.installment_count ?? 0),
    calculation_mode: row.calculation_mode as StudentPaymentPlanSummary['calculation_mode'],
    plan_status: row.plan_status as StudentPaymentPlanSummary['plan_status'],
    display_student_name: row.display_student_name != null ? String(row.display_student_name) : null,
    display_student_email:
      row.display_student_email != null ? String(row.display_student_email) : null,
    installment_row_count: Number(row.installment_row_count ?? 0),
    installment_total: Number(row.installment_total ?? 0),
    total_paid: Number(row.total_paid ?? 0),
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

export async function assignPaymentPlanWithInstallments(
  planId: number,
  studentId: number,
  assignedBy: number,
  startDate: string,
  installments: AssignInstallmentInput[]
): Promise<number> {
  const { data, error } = await supabase.rpc('skyline_assign_payment_plan_student_with_installments', {
    p_plan_id: planId,
    p_student_id: studentId,
    p_start_date: pickerToIsoDate(startDate),
    p_assigned_by: assignedBy,
    p_installments: installments,
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
  patch: Pick<StudentPaymentPlanInstallment, 'status' | 'paid_amount' | 'payment_date' | 'notes'>
): Promise<void> {
  const { error } = await supabase
    .from('skyline_student_payment_plan_installments')
    .update({
      status: patch.status,
      paid_amount: patch.paid_amount,
      payment_date: patch.payment_date ? pickerToIsoDate(patch.payment_date) : null,
      notes: patch.notes,
    })
    .eq('id', installmentId);
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

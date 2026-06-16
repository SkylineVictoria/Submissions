export type PaymentPlanStatus = 'draft' | 'confirmed';

export type PaymentPlanCalculationMode = 'equal' | 'uneven' | 'custom';

export type PaymentPlanInstallmentStatus = 'pending' | 'paid' | 'partial' | 'overdue' | 'waived';

/** Reusable payment plan template (like a course). */
export interface PaymentPlanSummary {
  id: number;
  plan_name: string;
  total_amount: number;
  currency: string;
  installment_count: number;
  start_date: string;
  calculation_mode: PaymentPlanCalculationMode;
  regular_monthly_amount: number | null;
  notes: string | null;
  status: PaymentPlanStatus;
  confirmed_at: string | null;
  confirmed_by: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  assigned_student_count: number;
  installment_row_count: number;
  installment_total: number;
  total_paid: number;
  paid_count: number;
  pending_count: number;
}

/** Template installment row (schedule only — no payment tracking). */
export interface PaymentPlanTemplateInstallment {
  id: number;
  payment_plan_id: number;
  installment_number: number;
  due_date: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

/** Student ↔ plan assignment (many-to-many). */
export interface StudentPaymentPlanSummary {
  assignment_id: number;
  payment_plan_id: number;
  student_id: number;
  assignment_start_date: string;
  assignment_status: 'active' | 'inactive';
  assigned_at: string;
  assigned_by: number | null;
  plan_name: string;
  total_amount: number;
  currency: string;
  installment_count: number;
  calculation_mode: PaymentPlanCalculationMode;
  plan_status: PaymentPlanStatus;
  display_student_name: string | null;
  display_student_email: string | null;
  installment_row_count: number;
  installment_total: number;
  total_paid: number;
  paid_count: number;
  pending_count: number;
}

/** Per-student installment with payment tracking. */
export interface StudentPaymentPlanInstallment {
  id: number;
  student_payment_plan_id: number;
  installment_number: number;
  due_date: string;
  amount: number;
  status: PaymentPlanInstallmentStatus;
  paid_amount: number;
  payment_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentPlanFormValues {
  plan_name: string;
  total_amount: string;
  currency: string;
  installment_count: string;
  start_date: string;
  calculation_mode: PaymentPlanCalculationMode;
  regular_monthly_amount: string;
  notes: string;
}

export type PaymentPlanConfirmAction =
  | 'create'
  | 'change_total'
  | 'generate'
  | 'overwrite'
  | 'confirm_lock'
  | 'assign_student'
  | 'unassign_student';

export const PAYMENT_PLAN_CONFIRM_MESSAGES: Record<PaymentPlanConfirmAction, string> = {
  create:
    'You are about to create this payment plan template with the fixed total amount shown. Continue?',
  change_total:
    'Changing the total amount is a fixed figure commitment. Existing template installments may need to be regenerated. Continue?',
  generate:
    'Generate template installments from the fixed total amount using the selected calculation mode?',
  overwrite:
    'This will replace all existing template installment rows and refresh assigned students. Continue?',
  confirm_lock:
    'Confirm and lock this payment plan template? The total amount and schedule will no longer be editable.',
  assign_student:
    'Assign this payment plan to the selected student? Their installment schedule will be created from the template.',
  unassign_student:
    'Remove this student from the payment plan? Their installment rows for this plan will be deleted.',
};

export const INSTALLMENT_STATUS_OPTIONS: { value: PaymentPlanInstallmentStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partial' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'waived', label: 'Waived' },
];

export const CALCULATION_MODE_OPTIONS: { value: PaymentPlanCalculationMode; label: string }[] = [
  { value: 'equal', label: 'Equally divided' },
  { value: 'uneven', label: 'Uneven monthly amount' },
  { value: 'custom', label: 'Custom editable installments' },
];

/** Minimal student context for payment plan assignment UI. */
export interface StudentPaymentPlanContext {
  id: number;
  name: string;
  email: string;
}

/** Editable row while assigning a plan to a student. */
export interface AssignInstallmentDraft {
  installment_number: number;
  due_date: string;
  amount: string;
  waived: boolean;
  notes: string;
  record_payment: boolean;
  paid_amount: string;
  payment_date: string;
}

/** Payload sent to assign-with-installments RPC. */
export interface AssignInstallmentInput {
  installment_number: number;
  due_date: string;
  amount: number;
  status: PaymentPlanInstallmentStatus;
  paid_amount: number;
  payment_date: string | null;
  notes: string | null;
}

/** @deprecated Use PaymentPlanTemplateInstallment for template rows. */
export type PaymentPlanInstallment = StudentPaymentPlanInstallment & { payment_plan_id?: number };

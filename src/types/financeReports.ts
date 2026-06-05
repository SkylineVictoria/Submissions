export type FinanceReportDateType = 'invoice_date' | 'due_date' | 'last_payment_date';

export type FinanceReportStatusFilter =
  | 'all'
  | 'paid'
  | 'pending'
  | 'void'
  | 'cancelled';

export type FinanceInvoiceStatus = 'Paid' | 'Pending' | 'Partially Paid' | 'Void' | 'Cancelled';

export type FinanceReportsFilters = {
  dateFrom: string;
  dateTo: string;
  dateType: FinanceReportDateType;
  status: FinanceReportStatusFilter;
  studentSearch: string;
};

export type FinanceReportRow = {
  invoiceId: string;
  invoiceNo: string;
  contactId: string;
  studentName: string;
  email: string;
  organisation?: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  paidAmount: number;
  balance: number;
  isPaid: boolean;
  status: FinanceInvoiceStatus;
  firstPaymentDate?: string | null;
  lastPaymentDate?: string | null;
  paymentCount?: number;
  paymentMethod?: string | null;
};

export type FinanceReportsSummary = {
  totalInvoiced: number;
  paidTotal: number;
  outstandingTotal: number;
  voidTotal: number;
  cancelledTotal: number;
  adjustmentTotal: number;
  reconciliationTotal: number;
  isReconciled: boolean;
  collectedByPaymentDate: number;
  paidWithoutPaymentDateCount: number;
};

export type FinanceStatusBreakdownItem = {
  name: FinanceInvoiceStatus;
  value: number;
};

export type FinanceMonthlyTrendItem = {
  month: string;
  invoiced: number;
  collected: number;
};

export type FinanceMonthlyPaymentTrendItem = {
  month: string;
  collected: number;
};

export type FinanceOutstandingByMonthItem = {
  month: string;
  outstanding: number;
};

export type FinanceReportsCharts = {
  statusBreakdown: FinanceStatusBreakdownItem[];
  monthlyCollectionTrend: FinanceMonthlyTrendItem[];
  monthlyPaymentTrend: FinanceMonthlyPaymentTrendItem[];
  outstandingByDueMonth: FinanceOutstandingByMonthItem[];
  paymentDatesAvailable: boolean;
  collectionTrendWarning: string | null;
};

export type FinanceReportsDebug = {
  invoiceCount: number;
  paymentCount: number;
  matchedPaymentCount: number;
  unmatchedPaymentCount: number;
  paymentEndpointUsed: string | null;
  paymentEndpointWarning: string | null;
  rawCount: number;
  filteredCount: number;
  minInvoiceDate: string | null;
  maxInvoiceDate: string | null;
  dateFilterApplied: boolean;
  dateType?: FinanceReportDateType;
  dateFrom?: string;
  dateTo?: string;
  lastSyncedAt?: string | null;
};

export type FinanceReportsSuccessResponse = {
  success: true;
  summary: FinanceReportsSummary;
  rows: FinanceReportRow[];
  charts: FinanceReportsCharts;
  debug?: FinanceReportsDebug;
};

export type FinanceReportsErrorResponse = {
  success: false;
  message: string;
  details?: unknown;
};

export type FinanceReportsResponse = FinanceReportsSuccessResponse | FinanceReportsErrorResponse;

export type FinanceSyncSuccessResponse = {
  success: true;
  syncedContacts: number;
  syncedInvoices: number;
  insertedOrUpdated: number;
  syncedPayments?: number;
  matchedPaymentCount?: number;
  unmatchedPaymentCount?: number;
  paymentEndpointUsed?: string | null;
  paymentEndpointWarning?: string | null;
  errors: string[];
  offset?: number;
  limit?: number;
  totalContacts?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
};

export type FinanceSyncErrorResponse = {
  success: false;
  message: string;
  errors?: string[];
  details?: unknown;
};

export type FinanceSyncResponse = FinanceSyncSuccessResponse | FinanceSyncErrorResponse;

export type FinanceReportStatusFilter = 'all' | 'paid' | 'pending' | 'partially_paid';

export type FinanceInvoiceStatus = 'Paid' | 'Pending' | 'Partially Paid';

export type FinanceReportsFilters = {
  dateFrom: string;
  dateTo: string;
  status: FinanceReportStatusFilter;
  studentSearch: string;
  course: string;
  agent: string;
};

export type FinanceReportRow = {
  invoiceId: string;
  invoiceNo: string;
  contactId: string;
  studentName: string;
  email: string;
  organisation: string;
  course: string;
  agent: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  paidAmount: number;
  balance: number;
  isPaid: boolean;
  status: FinanceInvoiceStatus;
};

export type FinanceReportsSummary = {
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  paidInvoices: number;
  pendingInvoices: number;
  partiallyPaidInvoices: number;
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

export type FinanceOutstandingByMonthItem = {
  month: string;
  outstanding: number;
};

export type FinanceReportsCharts = {
  statusBreakdown: FinanceStatusBreakdownItem[];
  monthlyCollectionTrend: FinanceMonthlyTrendItem[];
  outstandingByDueMonth: FinanceOutstandingByMonthItem[];
};

export type FinanceReportsDebug = {
  rawCount: number;
  filteredCount: number;
  dateFrom: string;
  dateTo: string;
  sampleDates: Array<{ invoiceNo: string; invoiceDate: string; dueDate: string }>;
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

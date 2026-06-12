export type FinanceReportDateType =
  | 'invoice_date'
  | 'due_date'
  | 'last_payment_date'
  | 'ledger_date'
  | 'entry_date'
  | 'payment_date';

export type FinanceReportView = 'invoice_directory' | 'ledger';

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
  reportView: FinanceReportView;
};

export type FinancePaymentTransactionRow = {
  paymentId: string;
  transactionId: string | null;
  invoiceId: string | null;
  invoiceNo: string;
  contactId: string;
  studentName: string;
  paymentDate: string | null;
  transactionDate: string | null;
  paymentMethod: string | null;
  transactionType: string | null;
  paymentAmount: number;
  unappliedAmount: number;
  userFullName: string | null;
  reference: string | null;
};

export type FinanceLedgerRow = {
  contactId: string;
  studentName: string;
  email: string;
  ledgerDate: string;
  entryDateTime: string | null;
  entryType: string;
  reference: string;
  description: string;
  relatedInvoiceNo: string;
  relatedInvoiceId: string;
  debit: number;
  credit: number;
  balance: number;
  paymentMethod: string;
};

export type FinanceLedgerSummary = {
  totalDebit: number;
  totalCredit: number;
  netMovement: number;
  paymentReceivedTotal: number;
  invoiceDebitTotal: number;
  ledgerEntries: number;
  summaryNote: string | null;
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
  paymentDate?: string | null;
  paymentCount?: number;
  paymentMethod?: string | null;
  hasPaymentDate?: boolean;
  paymentDateMissing?: boolean;
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
  paidWithoutPaymentDateCount: number;
  summaryNote?: string | null;
};

export type FinanceStatusBreakdownItem = {
  name: FinanceInvoiceStatus;
  value: number;
};

export type FinanceMonthlyAmountItem = {
  month: string;
  amount: number;
};

export type FinanceOutstandingByMonthItem = {
  month: string;
  outstanding: number;
};

export type FinanceReportsCharts = {
  statusBreakdown: FinanceStatusBreakdownItem[];
  monthlyByPaymentDate: FinanceMonthlyAmountItem[];
  monthlyByInvoiceDate: FinanceMonthlyAmountItem[];
  outstandingByDueMonth: FinanceOutstandingByMonthItem[];
  paymentDatesAvailable: boolean;
  paymentTrendWarning: string | null;
};

export type FinancePaymentDiagnostics = {
  dateFromIso: string;
  dateToIso: string;
  totalRowsInAxInvoicePayments: number;
  rowsWithAnyPaymentDate: number;
  rowsInDateRangeBeforeTypeMethodFilter: number;
  rowsAfterMoneyReceivedFilter: number;
  rowsAfterMethodExclusion: number;
  rowsAfterStudentSearch: number;
  paymentTransactionsReturned: number;
  matchedTransactionsReturned: number;
  unmatchedTransactionsReturned: number;
  distinctInvoiceIdsFromTransactions: number;
  distinctInvoiceIdsFoundInAxInvoices: number;
  distinctInvoiceIdsMissingFromAxInvoices: number;
  missingInvoiceIds: string[];
  missingInvoiceIdsFromLocalCache: string[];
  sampleExcludedRowsByReason: Record<string, unknown>;
};

export type PaymentDateFilterDebug = {
  paymentTransactionsInRange: number;
  paymentsWithDirectInvoiceId: number;
  paymentsWithoutInvoiceId: number;
  paymentsResolvedByContactId: number;
  paymentsResolvedByStudentName: number;
  paymentsAllocatedByFifo: number;
  invoiceRowsReturned: number;
  distinctStudentsInPayments: number;
  distinctStudentsMappedToInvoices: number;
  unmappedPaymentSamples: Array<{
    studentName: string;
    paymentAmount: number;
    paymentDate: string | null;
    reference: string | null;
    contactId: string | null;
    rawJsonKeys: string[];
  }>;
};

export type FinanceReportsDebug = {
  invoiceCount: number;
  invoiceRowsTotal?: number;
  invoiceRowsFiltered?: number;
  paymentCount: number;
  paymentTransactionsTotal?: number;
  paymentTransactionsInDateRange?: number;
  distinctInvoicesWithPaymentsInDateRange?: number;
  unmatchedPaymentsInDateRange?: number;
  missingInvoiceIdsFromLocalCache?: string[];
  paymentDiagnostics?: FinancePaymentDiagnostics;
  matchedPaymentCount: number;
  unmatchedPaymentCount: number;
  rowsWithPaymentDate?: number;
  rowsWithoutPaymentDate?: number;
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
  dateRangeClamped?: boolean;
  paidInvoicesTotal?: number;
  paidInvoicesWithPaymentDate?: number;
  paidInvoicesMissingPaymentDate?: number;
  allocationsCreated?: number;
  highConfidenceAllocations?: number;
  mediumConfidenceAllocations?: number;
  lowConfidenceAllocations?: number;
  distinctAllocatedInvoices?: number;
  unmatchedPayments?: number;
  unallocatedPaidInvoices?: number;
  paymentDateFilterDebug?: PaymentDateFilterDebug | null;
  ledgerCount?: number;
  ledgerRowsTotal?: number;
  ledgerRowsFiltered?: number;
  ledgerInvoiceIdsInRange?: number;
  reportView?: FinanceReportView;
  debugPaymentTransactions?: FinancePaymentTransactionRow[];
  lastSyncedAt?: string | null;
};

export type FinanceReportsSuccessResponse = {
  success: true;
  reportView?: FinanceReportView;
  summary: FinanceReportsSummary;
  ledgerSummary?: FinanceLedgerSummary;
  rows: FinanceReportRow[];
  ledgerRows?: FinanceLedgerRow[];
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
  paymentsWithDateCount?: number;
  paymentsWithoutDateCount?: number;
  paymentPagesFetched?: number;
  paymentRawRecordsFetched?: number;
  paymentUniqueRecordsFetched?: number;
  paymentDuplicateRecordsSkipped?: number;
  contactsWithPaymentRecords?: number;
  contactsWithoutPaymentRecords?: number;
  samplePaymentFetchUrlsWithoutTokens?: string[];
  totalContactIdsFromStudents?: number;
  totalContactIdsFromInvoices?: number;
  totalUniqueContactIdsToSync?: number;
  syncMode?: string;
  globalTransactionEndpointUsed?: string | null;
  paymentEndpointUsed?: string | null;
  paymentEndpointWarning?: string | null;
  samplePaymentRawKeys?: string[];
  samplePaymentDateValues?: Record<string, string>;
  errors: string[];
  offset?: number;
  limit?: number;
  totalContacts?: number;
  nextOffset?: number | null;
  hasMore?: boolean;
  allocationBackfill?: {
    allocationsCreated: number;
    highConfidenceAllocations: number;
    mediumConfidenceAllocations: number;
    lowConfidenceAllocations: number;
    unmatchedPayments: number;
    unallocatedPaidInvoices: number;
    paidInvoicesTotal: number;
    paidInvoicesWithPaymentDate: number;
    paidInvoicesMissingPaymentDate: number;
    invoicesUpdated: number;
  };
  ledgerEndpointUsed?: string | null;
  ledgerEndpointWarning?: string | null;
  ledgerContactsSynced?: number;
  ledgerRowsFetched?: number;
  ledgerRowsUpserted?: number;
  ledgerRowsWithRelatedInvoice?: number;
  ledgerRowsWithoutRelatedInvoice?: number;
  ledgerRowsLinkedToInvoice?: number;
  ledgerRowsUnlinkedToInvoice?: number;
  sampleLedgerRows?: Record<string, unknown>[];
  sampleLedgerRawKeys?: string[];
};

export type FinanceSyncErrorResponse = {
  success: false;
  message: string;
  errors?: string[];
  details?: unknown;
};

export type FinanceSyncResponse = FinanceSyncSuccessResponse | FinanceSyncErrorResponse;

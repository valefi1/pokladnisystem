export const emptyState = {
  products: [],
  movements: [],
  sales: [],
  movementHistory: [],
  imports: {},
  suppliers: [],
  stockReceipts: [],
  stockReceiptDraft: null,
  auditLog: [],
  dayClosures: [],
  cashSessions: [],
  syncQueue: [],
};

export function normalizeState(partial = {}) {
  return {
    products: partial.products ?? emptyState.products,
    movements: partial.movements ?? emptyState.movements,
    sales: partial.sales ?? emptyState.sales,
    movementHistory: partial.movementHistory ?? emptyState.movementHistory,
    imports: partial.imports ?? emptyState.imports,
    suppliers: partial.suppliers ?? emptyState.suppliers,
    stockReceipts: partial.stockReceipts ?? emptyState.stockReceipts,
    stockReceiptDraft: partial.stockReceiptDraft ?? emptyState.stockReceiptDraft,
    auditLog: partial.auditLog ?? emptyState.auditLog,
    dayClosures: partial.dayClosures ?? emptyState.dayClosures,
    cashSessions: partial.cashSessions ?? emptyState.cashSessions,
    syncQueue: partial.syncQueue ?? emptyState.syncQueue,
  };
}

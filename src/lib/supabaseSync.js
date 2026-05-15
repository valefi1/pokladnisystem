import { emptyState, normalizeState } from '../data/initialState';
import { supabase, supabaseConfigured, getSupabaseUser } from './supabaseClient';

const SYNC_TABLES = {
  products: 'pos_products',
  movements: 'pos_stock_movements',
  sales: 'pos_sales',
  movementHistory: 'pos_movement_history',
  suppliers: 'pos_suppliers',
  stockReceipts: 'pos_stock_receipts',
  auditLog: 'pos_audit_log',
  dayClosures: 'pos_day_closures',
  cashSessions: 'pos_cash_sessions',
};

function nowIso() {
  return new Date().toISOString();
}

function jsonRow(userId, item) {
  return {
    id: String(item.id),
    owner_id: userId,
    payload: item,
    updated_at: nowIso(),
  };
}

function productRow(userId, product) {
  return {
    ...jsonRow(userId, product),
    name: product.name || '',
    category: product.category || '',
    barcode: product.barcode || '',
    plu: product.plu || '',
    price: Number(product.price) || 0,
    stock: Number(product.stock) || 0,
    hidden: Boolean(product.hidden),
  };
}

function saleRow(userId, sale) {
  return {
    ...jsonRow(userId, sale),
    document_number: sale.documentNumber || sale.id,
    created_at: sale.createdAt || nowIso(),
    payment_method: sale.paymentMethod || '',
    total: Number(sale.total) || 0,
    tip_amount: Number(sale.tipAmount) || 0,
    unpaid: Boolean(sale.unpaid),
  };
}

function movementRow(userId, movement) {
  return {
    ...jsonRow(userId, movement),
    product_id: movement.productId || '',
    movement_type: movement.type || '',
    quantity: Number(movement.quantity) || 0,
    created_at: movement.createdAt || nowIso(),
  };
}

function supplierRow(userId, supplier) {
  return {
    ...jsonRow(userId, supplier),
    name: supplier.name || '',
    vat_no: supplier.vatNo || '',
    vat_id: supplier.vatId || '',
  };
}

function receiptRow(userId, receipt) {
  return {
    ...jsonRow(userId, receipt),
    supplier_name: receipt.supplierName || '',
    document_number: receipt.documentNumber || receipt.id,
    stocked_at: receipt.stockedAt || receipt.completedAt || nowIso(),
    total_cost: Number(receipt.totalCost) || 0,
  };
}

function auditRow(userId, entry) {
  return {
    ...jsonRow(userId, entry),
    action: entry.action || '',
    entity_type: entry.entityType || '',
    entity_id: entry.entityId || '',
    created_at: entry.createdAt || nowIso(),
  };
}


function cashSessionRow(userId, session) {
  return {
    ...jsonRow(userId, session),
    business_date: session.businessDate || new Date().toISOString().slice(0, 10),
    opened_at: session.openedAt || nowIso(),
    closed_at: session.closedAt || null,
    opening_cash: Number(session.openingCash) || 0,
    opening_cash_breakdown: session.openingCashBreakdown || {},
    expected_opening_cash: session.expectedOpeningCash == null ? null : Number(session.expectedOpeningCash) || 0,
    opening_difference: session.openingDifference == null ? null : Number(session.openingDifference) || 0,
    previous_cash_session_id: session.previousCashSessionId || '',
    counted_cash: session.countedCash == null ? null : Number(session.countedCash) || 0,
    closing_cash_breakdown: session.closingCashBreakdown || {},
    expected_cash: session.expectedCash == null ? null : Number(session.expectedCash) || 0,
    cash_difference: session.cashDifference == null ? null : Number(session.cashDifference) || 0,
    status: session.closedAt ? 'closed' : 'open',
  };
}

function closureRow(userId, closure) {
  return {
    ...jsonRow(userId, closure),
    closed_at: closure.closedAt || nowIso(),
    business_date: closure.businessDate || new Date().toISOString().slice(0, 10),
    total_cash: Number(closure.totalCash) || 0,
    total_card: Number(closure.totalCard) || 0,
    total_revenue: Number(closure.totalRevenue) || 0,
  };
}

const rowBuilders = {
  products: productRow,
  sales: saleRow,
  movements: movementRow,
  movementHistory: movementRow,
  suppliers: supplierRow,
  stockReceipts: receiptRow,
  auditLog: auditRow,
  dayClosures: closureRow,
  cashSessions: cashSessionRow,
};

async function getUserIdOrThrow() {
  const user = await getSupabaseUser();
  if (!user?.id) throw new Error('Supabase je nastavený, ale uživatel není přihlášený.');
  return user.id;
}

export async function loadRemoteState() {
  if (!supabaseConfigured || !supabase) return null;
  const userId = await getUserIdOrThrow();
  const next = normalizeState(emptyState);

  for (const [key, table] of Object.entries(SYNC_TABLES)) {
    const { data, error } = await supabase
      .from(table)
      .select('payload')
      .eq('owner_id', userId)
      .order(key === 'sales' ? 'created_at' : 'updated_at', { ascending: false });

    if (error) throw error;
    next[key] = (data || []).map((row) => row.payload).filter(Boolean);
  }

  const { data: settingsData, error: settingsError } = await supabase
    .from('pos_settings')
    .select('key,payload')
    .eq('owner_id', userId);
  if (settingsError) throw settingsError;

  const settings = Object.fromEntries((settingsData || []).map((row) => [row.key, row.payload]));
  next.imports = settings.imports || {};
  next.stockReceiptDraft = settings.stockReceiptDraft || null;
  return normalizeState(next);
}

export async function syncStateToSupabase(state) {
  if (!supabaseConfigured || !supabase) return { skipped: true };
  const userId = await getUserIdOrThrow();
  const normalized = normalizeState(state);

  for (const [key, table] of Object.entries(SYNC_TABLES)) {
    const builder = rowBuilders[key];
    const rows = (normalized[key] || []).filter((item) => item?.id).map((item) => builder(userId, item));
    if (!rows.length) continue;
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'owner_id,id' });
    if (error) throw error;
  }

  const settingsRows = [
    { owner_id: userId, key: 'imports', payload: normalized.imports || {}, updated_at: nowIso() },
    { owner_id: userId, key: 'stockReceiptDraft', payload: normalized.stockReceiptDraft || null, updated_at: nowIso() },
  ];
  const { error: settingsError } = await supabase.from('pos_settings').upsert(settingsRows, { onConflict: 'owner_id,key' });
  if (settingsError) throw settingsError;
  return { ok: true };
}

export function getSyncModeLabel() {
  if (!supabaseConfigured) return 'Lokální režim';
  return 'Supabase sync';
}

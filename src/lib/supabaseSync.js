import { emptyState, normalizeState } from '../data/initialState';
import { supabase, supabaseConfigured, getSupabaseUser } from './supabaseClient';
import { netFromGross, normalizeProductVatPricing } from './vat';

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
  parkedTickets: 'pos_parked_tickets',
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
  const normalized = normalizeProductVatPricing(product);
  return {
    ...jsonRow(userId, normalized),
    name: normalized.name || '',
    category: normalized.category || '',
    barcode: normalized.barcode || '',
    plu: normalized.plu || '',
    price: Number(normalized.priceWithVat ?? normalized.price) || 0,
    price_with_vat: Number(normalized.priceWithVat ?? normalized.price) || 0,
    price_without_vat: Number(normalized.priceWithoutVat) || netFromGross(normalized.priceWithVat ?? normalized.price, normalized.vatRate),
    vat_rate: Number(normalized.vatRate) || 0,
    stock: Number(normalized.stock) || 0,
    hidden: Boolean(normalized.hidden),
  };
}

function productFromRow(row) {
  // Older versions stored the source of truth inside payload. Newer versions also keep searchable columns.
  // Merge columns over payload so fixes made directly in Supabase are reflected in the app immediately.
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return normalizeProductVatPricing({
    ...payload,
    id: row.id ?? payload.id,
    name: row.name ?? payload.name,
    category: row.category ?? payload.category,
    barcode: row.barcode ?? payload.barcode,
    plu: row.plu ?? payload.plu,
    price: row.price_with_vat ?? row.price ?? payload.priceWithVat ?? payload.price,
    priceWithVat: row.price_with_vat ?? row.price ?? payload.priceWithVat ?? payload.price,
    priceWithoutVat: row.price_without_vat ?? payload.priceWithoutVat,
    vatRate: row.vat_rate ?? payload.vatRate,
    stock: row.stock ?? payload.stock,
    hidden: row.hidden ?? payload.hidden,
  });
}



function presentationPatchFromProduct(product = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(product, 'displayOrder')) patch.displayOrder = product.displayOrder;
  if (Object.prototype.hasOwnProperty.call(product, 'tileColor')) patch.tileColor = product.tileColor;
  if (Object.prototype.hasOwnProperty.call(product, 'colorKey')) patch.colorKey = product.colorKey;
  return patch;
}

function saleRow(userId, sale) {
  return {
    ...jsonRow(userId, sale),
    document_number: sale.documentNumber || sale.id,
    created_at: sale.createdAt || nowIso(),
    payment_method: sale.paymentMethod || '',
    total: Number(sale.total) || 0,
    total_without_vat: Number(sale.subtotalWithoutVat) || 0,
    vat_total: Number(sale.vatTotal) || 0,
    tip_amount: Number(sale.tipAmount) || 0,
    unpaid: Boolean(sale.unpaid),
  };
}

function saleFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    documentNumber: row.document_number ?? payload.documentNumber,
    createdAt: row.created_at ?? payload.createdAt,
    paymentMethod: row.payment_method ?? payload.paymentMethod,
    total: Number(row.total ?? payload.total) || 0,
    subtotalWithoutVat: Number(row.total_without_vat ?? payload.subtotalWithoutVat) || 0,
    vatTotal: Number(row.vat_total ?? payload.vatTotal) || 0,
    tipAmount: Number(row.tip_amount ?? payload.tipAmount) || 0,
    unpaid: Boolean(row.unpaid ?? payload.unpaid),
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

function movementFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    productId: row.product_id ?? payload.productId,
    type: row.movement_type ?? payload.type,
    quantity: Number(row.quantity ?? payload.quantity) || 0,
    createdAt: row.created_at ?? payload.createdAt,
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

function supplierFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    name: row.name ?? payload.name,
    vatNo: row.vat_no ?? payload.vatNo,
    vatId: row.vat_id ?? payload.vatId,
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

function receiptFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    supplierName: row.supplier_name ?? payload.supplierName,
    documentNumber: row.document_number ?? payload.documentNumber,
    stockedAt: row.stocked_at ?? payload.stockedAt,
    totalCost: Number(row.total_cost ?? payload.totalCost) || 0,
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

function auditFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    action: row.action ?? payload.action,
    entityType: row.entity_type ?? payload.entityType,
    entityId: row.entity_id ?? payload.entityId,
    createdAt: row.created_at ?? payload.createdAt,
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

function cashSessionFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    businessDate: row.business_date ?? payload.businessDate,
    openedAt: row.opened_at ?? payload.openedAt,
    closedAt: row.closed_at ?? payload.closedAt,
    openingCash: Number(row.opening_cash ?? payload.openingCash) || 0,
    openingCashBreakdown: row.opening_cash_breakdown ?? payload.openingCashBreakdown ?? {},
    expectedOpeningCash: row.expected_opening_cash ?? payload.expectedOpeningCash ?? null,
    openingDifference: row.opening_difference ?? payload.openingDifference ?? null,
    previousCashSessionId: row.previous_cash_session_id ?? payload.previousCashSessionId ?? '',
    countedCash: row.counted_cash ?? payload.countedCash ?? null,
    closingCashBreakdown: row.closing_cash_breakdown ?? payload.closingCashBreakdown ?? {},
    expectedCash: row.expected_cash ?? payload.expectedCash ?? null,
    cashDifference: row.cash_difference ?? payload.cashDifference ?? null,
    status: row.status ?? payload.status ?? (row.closed_at ? 'closed' : 'open'),
  };
}

function lineGross(item) {
  return (Number(item.priceWithVat ?? item.price) || 0) * (Number(item.quantity) || 0);
}

function lineDiscount(item) {
  const gross = lineGross(item);
  const raw = Number(item.discountValue) || 0;
  if (raw <= 0 || gross <= 0) return 0;
  if (item.discountType === 'percent') return Math.min(gross, gross * raw / 100);
  return Math.min(gross, raw);
}

function parkedTicketTotal(ticket) {
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, lineGross(item) - lineDiscount(item)), 0);
  const raw = Number(ticket.discountValue) || 0;
  const orderDiscount = ticket.discountMode === 'percent' ? Math.min(subtotal, subtotal * raw / 100) : Math.min(subtotal, raw);
  return Math.max(0, subtotal - Math.max(0, orderDiscount));
}

function parkedTicketRow(userId, ticket) {
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  const total = parkedTicketTotal(ticket);
  const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  return {
    ...jsonRow(userId, ticket),
    name: ticket.name || 'Účet',
    total,
    item_count: itemCount,
    status: ticket.status || 'open',
  };
}

function parkedTicketFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    name: row.name ?? payload.name ?? 'Účet',
    status: row.status ?? payload.status ?? 'open',
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

function closureFromRow(row) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id ?? payload.id,
    closedAt: row.closed_at ?? payload.closedAt,
    businessDate: row.business_date ?? payload.businessDate,
    totalCash: Number(row.total_cash ?? payload.totalCash) || 0,
    totalCard: Number(row.total_card ?? payload.totalCard) || 0,
    totalRevenue: Number(row.total_revenue ?? payload.totalRevenue) || 0,
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
  parkedTickets: parkedTicketRow,
};

const rowReaders = {
  products: productFromRow,
  sales: saleFromRow,
  movements: movementFromRow,
  movementHistory: movementFromRow,
  suppliers: supplierFromRow,
  stockReceipts: receiptFromRow,
  auditLog: auditFromRow,
  dayClosures: closureFromRow,
  cashSessions: cashSessionFromRow,
  parkedTickets: parkedTicketFromRow,
};

async function getUserIdOrThrow() {
  const user = await getSupabaseUser();
  if (!user?.id) throw new Error('Supabase je nastavený, ale uživatel není přihlášený.');
  return user.id;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function getImportMatchKey(productLike = {}) {
  if (productLike.barcode) return `barcode:${String(productLike.barcode).trim()}`;
  if (productLike.plu) return `plu:${String(productLike.plu).trim()}`;
  return `name:${normalizeText(productLike.name)}|cat:${normalizeText(productLike.category)}`;
}

function numbersClose(a, b, tolerance = 0.01) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tolerance;
}

function isMissingRelation(error) {
  return error?.code === '42P01' || /does not exist|relation .* does not exist/i.test(error?.message || '');
}

async function readTable(key, table, userId) {
  const orderColumn = key === 'sales' ? 'created_at' : key === 'cashSessions' ? 'opened_at' : 'updated_at';
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('owner_id', userId)
    .order(orderColumn, { ascending: false });

  if (error) throw error;
  const reader = rowReaders[key] || ((row) => row?.payload);
  return (data || []).map((row) => reader(row)).filter(Boolean);
}

async function readSettings(userId) {
  async function readFrom(tableName) {
    const { data, error } = await supabase
      .from(tableName)
      .select('key,payload')
      .eq('owner_id', userId);
    if (error) throw error;
    return Object.fromEntries((data || []).map((row) => [row.key, row.payload]));
  }

  try {
    return await readFrom('pos_settings');
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
  }

  // Compatibility with early builds that accidentally created pos_setting singular.
  try {
    return await readFrom('pos_setting');
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return {};
  }
}

export async function loadRemoteState() {
  if (!supabaseConfigured || !supabase) return null;
  const userId = await getUserIdOrThrow();
  const next = normalizeState(emptyState);

  for (const [key, table] of Object.entries(SYNC_TABLES)) {
    next[key] = await readTable(key, table, userId);
  }

  const settings = await readSettings(userId);
  next.imports = settings.imports || {};
  next.stockReceiptDraft = settings.stockReceiptDraft || null;
  return normalizeState(next);
}

async function deleteMissingParkedTickets(userId, normalized) {
  const ids = new Set((normalized.parkedTickets || []).filter((item) => item?.id).map((item) => String(item.id)));
  const { data, error: readError } = await supabase
    .from(SYNC_TABLES.parkedTickets)
    .select('id')
    .eq('owner_id', userId);
  if (readError) throw readError;

  const staleIds = (data || []).map((row) => row.id).filter((id) => !ids.has(String(id)));
  if (staleIds.length === 0) return;

  const { error } = await supabase
    .from(SYNC_TABLES.parkedTickets)
    .delete()
    .eq('owner_id', userId)
    .in('id', staleIds);
  if (error) throw error;
}

async function syncSettings(userId, normalized) {
  const settingsRows = [
    { owner_id: userId, key: 'imports', payload: normalized.imports || {}, updated_at: nowIso() },
    { owner_id: userId, key: 'stockReceiptDraft', payload: normalized.stockReceiptDraft || null, updated_at: nowIso() },
  ];

  const { error } = await supabase.from('pos_settings').upsert(settingsRows, { onConflict: 'owner_id,key' });
  if (!error) return;
  if (!isMissingRelation(error)) throw error;

  // Compatibility fallback for older DBs. New schema.sql creates pos_settings.
  const fallback = await supabase.from('pos_setting').upsert(settingsRows, { onConflict: 'owner_id,key' });
  if (fallback.error && !isMissingRelation(fallback.error)) throw fallback.error;
}


export async function syncProductPresentationToSupabase(state, productIds = []) {
  if (!supabaseConfigured || !supabase) return { skipped: true };
  const userId = await getUserIdOrThrow();
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { ok: true, updated: 0 };

  const normalized = normalizeState(state);
  const localById = new Map((normalized.products || []).map((product) => [String(product.id), product]));
  const { data, error } = await supabase
    .from(SYNC_TABLES.products)
    .select('*')
    .eq('owner_id', userId)
    .in('id', ids);
  if (error) throw error;

  const remoteById = new Map((data || []).map((row) => [String(row.id), row]));
  const rows = ids.map((id) => {
    const local = localById.get(id);
    if (!local) return null;
    const remote = remoteById.get(id);
    if (!remote) return productRow(userId, local);
    const payload = remote.payload && typeof remote.payload === 'object' ? remote.payload : {};
    return {
      ...remote,
      owner_id: userId,
      id,
      payload: {
        ...payload,
        ...presentationPatchFromProduct(local),
      },
      updated_at: nowIso(),
    };
  }).filter(Boolean);

  if (!rows.length) return { ok: true, updated: 0 };
  const { error: upsertError } = await supabase.from(SYNC_TABLES.products).upsert(rows, { onConflict: 'owner_id,id' });
  if (upsertError) throw upsertError;
  return { ok: true, updated: rows.length };
}



export async function upsertImportedProductsToSupabase(importedProducts = [], localProducts = []) {
  if (!supabaseConfigured || !supabase) return { skipped: true };
  const userId = await getUserIdOrThrow();
  const incoming = (importedProducts || []).filter((item) => item?.name || item?.barcode || item?.plu);
  if (!incoming.length) return { ok: true, updated: 0 };

  const { data: remoteRows, error: readError } = await supabase
    .from(SYNC_TABLES.products)
    .select('*')
    .eq('owner_id', userId);
  if (readError) throw readError;

  const remoteProducts = (remoteRows || []).map(productFromRow);
  const existingByKey = new Map();
  for (const product of [...remoteProducts, ...(localProducts || [])]) {
    if (!product) continue;
    existingByKey.set(getImportMatchKey(product), product);
  }

  const rows = incoming.map((raw) => {
    const normalizedIncoming = normalizeProductVatPricing(raw);
    const key = getImportMatchKey(normalizedIncoming);
    const existing = existingByKey.get(key) || null;
    const merged = normalizeProductVatPricing({
      ...(existing || {}),
      ...normalizedIncoming,
      id: existing?.id || normalizedIncoming.id || `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      hidden: existing?.hidden ?? normalizedIncoming.hidden ?? false,
      displayOrder: existing?.displayOrder ?? normalizedIncoming.displayOrder,
      tileColor: existing?.tileColor ?? normalizedIncoming.tileColor,
      colorKey: existing?.colorKey ?? normalizedIncoming.colorKey,
      importedAt: new Date().toISOString(),
    });
    return productRow(userId, merged);
  });

  const { error: upsertError } = await supabase
    .from(SYNC_TABLES.products)
    .upsert(rows, { onConflict: 'owner_id,id' });
  if (upsertError) throw upsertError;

  const ids = rows.map((row) => row.id);
  const { data: writtenRows, error: verifyError } = await supabase
    .from(SYNC_TABLES.products)
    .select('*')
    .eq('owner_id', userId)
    .in('id', ids);
  if (verifyError) throw verifyError;

  const writtenById = new Map((writtenRows || []).map((row) => [String(row.id), row]));
  const mismatches = [];
  for (const row of rows) {
    const written = writtenById.get(String(row.id));
    if (!written) {
      mismatches.push(`${row.name || row.id}: řádek se po zápisu nenačetl ze Supabase`);
      continue;
    }
    if (!numbersClose(written.price, row.price) || !numbersClose(written.price_with_vat, row.price_with_vat) || !numbersClose(written.price_without_vat, row.price_without_vat) || !numbersClose(written.vat_rate, row.vat_rate) || !numbersClose(written.stock, row.stock)) {
      mismatches.push(`${row.name || row.id}: očekáváno cena ${row.price}, DPH ${row.vat_rate}, sklad ${row.stock}; v DB je cena ${written.price}, DPH ${written.vat_rate}, sklad ${written.stock}`);
    }
  }

  if (mismatches.length) {
    throw new Error(`Import se nepodařilo ověřit v Supabase. ${mismatches.slice(0, 3).join(' | ')}`);
  }

  return { ok: true, updated: rows.length };
}

export async function syncProductsToSupabase(products = []) {
  if (!supabaseConfigured || !supabase) return { skipped: true };
  const userId = await getUserIdOrThrow();
  const rows = (products || [])
    .filter((item) => item?.id)
    .map((item) => productRow(userId, item));
  if (!rows.length) return { ok: true, updated: 0 };

  const { error } = await supabase
    .from(SYNC_TABLES.products)
    .upsert(rows, { onConflict: 'owner_id,id' });

  if (error) throw error;
  return { ok: true, updated: rows.length };
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

  await deleteMissingParkedTickets(userId, normalized);
  await syncSettings(userId, normalized);
  return { ok: true };
}

export function getSyncModeLabel() {
  if (!supabaseConfigured) return 'Lokální režim';
  return 'Supabase sync';
}

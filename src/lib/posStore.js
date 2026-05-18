import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { loadState, resetState, saveState } from './storage';
import { loadRemoteState, syncStateToSupabase, getSyncModeLabel } from './supabaseSync';
import { supabaseConfigured } from './supabaseClient';
import { buildVatBreakdown, netFromGross, normalizeProductVatPricing, roundMoney, vatFromGross } from './vat';

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildDocumentNumber(sequence, createdAt = new Date()) {
  const date = new Date(createdAt);
  const prefix = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

export const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

function getProductKey(productLike) {
  if (productLike.barcode) return `barcode:${String(productLike.barcode).trim()}`;
  if (productLike.plu) return `plu:${String(productLike.plu).trim()}`;
  return `name:${normalizeText(productLike.name)}|cat:${normalizeText(productLike.category)}`;
}

function mergeImportedProducts(existingProducts, incomingProducts) {
  const existingByKey = new Map(existingProducts.map((product) => [getProductKey(product), product]));
  const usedKeys = new Set();

  const merged = incomingProducts.map((product) => {
    const key = getProductKey(product);
    usedKeys.add(key);
    const existing = existingByKey.get(key);
    if (!existing) {
      return { ...normalizeProductVatPricing(product), analyticsKey: key };
    }
    return {
      ...existing,
      ...normalizeProductVatPricing(product),
      id: existing.id,
      hidden: existing.hidden ?? false,
      unit: product.unit || existing.unit || 'ks',
      analyticsKey: key,
    };
  });

  const untouched = existingProducts
    .filter((product) => !usedKeys.has(getProductKey(product)))
    .map((product) => ({ ...product, analyticsKey: getProductKey(product) }));

  return [...merged, ...untouched];
}

function linkHistoryToProducts(historyRows, products) {
  const productMap = new Map(products.map((product) => [getProductKey(product), product]));

  return historyRows.map((row) => {
    const match = productMap.get(getProductKey(row));
    return {
      ...row,
      productId: match?.id,
      analyticsKey: match ? getProductKey(match) : getProductKey(row),
      productName: match?.name || row.productName,
      category: match?.category || row.category || 'Nezařazeno',
    };
  });
}

function createSupplierIfMissing(state, supplierName) {
  const cleanName = String(supplierName || '').trim();
  if (!cleanName) return state.suppliers;
  const exists = state.suppliers.some((supplier) => normalizeText(supplier.name) === normalizeText(cleanName));
  if (exists) return state.suppliers;
  return [{ id: uid('sup'), name: cleanName, createdAt: new Date().toISOString() }, ...state.suppliers];
}

function auditEntry(action, entityType, entityId, label, details = {}) {
  return {
    id: uid('audit'),
    action,
    entityType,
    entityId: entityId || '',
    label: label || '',
    details,
    createdAt: new Date().toISOString(),
  };
}



function normalizeParkedTicket(ticket, fallbackName = 'Účet') {
  const now = new Date().toISOString();
  return {
    id: ticket?.id || uid('ticket'),
    name: String(ticket?.name || fallbackName).trim() || fallbackName,
    items: Array.isArray(ticket?.items) ? ticket.items : [],
    discountMode: ticket?.discountMode === 'percent' ? 'percent' : 'amount',
    discountValue: Number(ticket?.discountValue) || 0,
    createdAt: ticket?.createdAt || now,
    updatedAt: ticket?.updatedAt || now,
    status: ticket?.status || 'open',
  };
}

function getOpenCashSession(state) {
  return (state.cashSessions || []).find((session) => !session.closedAt) || null;
}

function getCashAmountFromSale(sale) {
  if (sale.unpaid) return 0;
  if (sale.paymentMethod === 'cash') return Number(sale.total) || 0;
  if (sale.paymentMethod === 'split') {
    return (sale.splitLegs || [])
      .filter((leg) => leg.method === 'cash')
      .reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0);
  }
  return 0;
}

function salesForCashSession(sales, session) {
  if (!session) return [];
  const opened = new Date(session.openedAt).getTime();
  const closed = session.closedAt ? new Date(session.closedAt).getTime() : Number.POSITIVE_INFINITY;
  return (sales || []).filter((sale) => {
    const created = new Date(sale.createdAt).getTime();
    return Number.isFinite(created) && created >= opened && created <= closed;
  });
}

function summarizeCashSessionSales(sales, session) {
  const relevantSales = salesForCashSession(sales, session);
  const totalCashSales = relevantSales.reduce((sum, sale) => sum + getCashAmountFromSale(sale), 0);
  const totalCard = relevantSales.filter((sale) => !sale.unpaid && sale.paymentMethod === 'card').reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const totalTransfer = relevantSales.filter((sale) => !sale.unpaid && sale.paymentMethod === 'transfer').reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const totalVoucher = relevantSales.filter((sale) => !sale.unpaid && sale.paymentMethod === 'voucher').reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  const totalRevenue = relevantSales.filter((sale) => !sale.unpaid).reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  return {
    sales: relevantSales,
    totalCashSales,
    totalCard,
    totalTransfer,
    totalVoucher,
    totalRevenue,
    expectedCash: (Number(session?.openingCash) || 0) + totalCashSales,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE_REMOTE': {
      const remote = action.payload || {};
      return {
        ...state,
        ...remote,
        parkedTickets: (remote.parkedTickets || []).map((ticket, index) => normalizeParkedTicket(ticket, `Účet ${index + 1}`)),
      };
    }
    case 'ADD_PRODUCT': {
      const product = normalizeProductVatPricing({ ...action.payload, id: uid('p') });
      return {
        ...state,
        products: [{ ...product, analyticsKey: getProductKey(product) }, ...state.products],
        auditLog: [auditEntry('create', 'product', product.id, product.name), ...state.auditLog],
      };
    }
    case 'UPDATE_PRODUCT': {
      return {
        ...state,
        products: state.products.map((product) =>
          product.id === action.payload.id
            ? { ...normalizeProductVatPricing({ ...product, ...action.payload }), analyticsKey: getProductKey({ ...product, ...action.payload }) }
            : product
        ),
        auditLog: [auditEntry('update', 'product', action.payload.id, action.payload.name || 'Úprava produktu', action.payload), ...state.auditLog],
      };
    }
    case 'IMPORT_STOCK_SNAPSHOT': {
      const products = mergeImportedProducts(state.products, action.payload.products);
      return {
        ...state,
        products,
        movementHistory: linkHistoryToProducts(state.movementHistory, products),
        imports: {
          ...state.imports,
          stockSnapshotName: action.payload.fileName,
          stockSnapshotAt: new Date().toISOString(),
          importedProductsCount: action.payload.products.length,
        },
      };
    }
    case 'IMPORT_DOTYKACKA_CSV': {
      // Hromadná aktualizace cen + přidání nových produktů z Dotykačka CSV exportu
      // Matchuje podle dotykackaId (productId z CSV), pak podle normalizovaného jména
      const incoming = action.payload.products; // [{dotykackaId, name, category, price, vatRate}]
      const existingById = new Map(state.products.filter(p=>p.dotykackaId).map(p=>[p.dotykackaId, p]));
      const existingByName = new Map(state.products.map(p=>[normalizeText(p.name), p]));
      const usedIds = new Set();

      const updated = state.products.map(p => {
        // Najdi match v CSV
        const byId = p.dotykackaId ? existingById.get(p.dotykackaId) : null;
        const incomingMatch = incoming.find(i =>
          (p.dotykackaId && i.dotykackaId === p.dotykackaId) ||
          normalizeText(i.name) === normalizeText(p.name)
        );
        if (!incomingMatch) return p;
        usedIds.add(incomingMatch.dotykackaId);
        return normalizeProductVatPricing({
          ...p,
          price: incomingMatch.priceWithVat ?? incomingMatch.price,
          priceWithVat: incomingMatch.priceWithVat ?? incomingMatch.price,
          priceWithoutVat: incomingMatch.priceWithoutVat,
          vatRate: incomingMatch.vatRate,
          category: incomingMatch.category || p.category,
          dotykackaId: incomingMatch.dotykackaId,
          // Zachová: stock, costPrice, barcode, plu, unit, hidden, note
        });
      });

      // Přidej nové produkty (nenalezené v existujících)
      const newProducts = incoming
        .filter(i => !usedIds.has(i.dotykackaId) && !existingByName.has(normalizeText(i.name)))
        .map(i => normalizeProductVatPricing({
          id: uid('p'),
          dotykackaId: i.dotykackaId,
          name: i.name,
          category: i.category,
          price: i.priceWithVat ?? i.price,
          priceWithVat: i.priceWithVat ?? i.price,
          priceWithoutVat: i.priceWithoutVat,
          vatRate: i.vatRate,
          costPrice: 0,
          stock: 0,
          unit: 'ks',
          barcode: '',
          plu: '',
          hidden: false,
        }));

      return {
        ...state,
        products: [...updated, ...newProducts],
        imports: {
          ...state.imports,
          dotykackaCsvName: action.payload.fileName,
          dotykackaCsvAt: new Date().toISOString(),
          dotykackaCsvUpdated: updated.filter(p=>usedIds.has(p.dotykackaId)||incoming.some(i=>normalizeText(i.name)===normalizeText(p.name))).length,
          dotykackaCsvAdded: newProducts.length,
        },
      };
    }

    case 'IMPORT_MOVEMENT_HISTORY': {
      const linked = linkHistoryToProducts(action.payload.rows, state.products);
      const timestamps = linked
        .map((row) => new Date(row.createdAt).getTime())
        .filter((value) => Number.isFinite(value));
      const range = timestamps.length
        ? { start: new Date(Math.min(...timestamps)).toISOString(), end: new Date(Math.max(...timestamps)).toISOString() }
        : state.imports.movementHistoryRange;
      return {
        ...state,
        movementHistory: linked,
        imports: {
          ...state.imports,
          movementHistoryName: action.payload.fileName,
          movementHistoryAt: new Date().toISOString(),
          movementHistoryRange: range,
          importedMovementRowsCount: linked.length,
        },
      };
    }
    case 'APPLY_STOCK_MOVEMENT': {
      const { productId, movementType, quantity, note } = action.payload;
      const amount = Number(quantity) || 0;
      let nextMovement = null;
      let nextHistory = state.movementHistory;

      const products = state.products.map((product) => {
        if (product.id !== productId) return product;
        const beforeStock = Number(product.stock) || 0;
        let afterStock = beforeStock;
        if (movementType === 'receipt') afterStock = beforeStock + amount;
        if (movementType === 'writeoff') afterStock = beforeStock - amount;
        if (movementType === 'inventory') afterStock = amount;
        nextMovement = {
          id: uid('m'),
          productId,
          productName: product.name,
          type: movementType,
          quantity: amount,
          beforeStock,
          afterStock,
          note: note?.trim() || '',
          createdAt: new Date().toISOString(),
        };

        if (movementType === 'writeoff') {
          nextHistory = [
            {
              id: uid('h'),
              productId,
              analyticsKey: getProductKey(product),
              productName: product.name,
              category: product.category,
              quantity: amount,
              type: 'writeoff',
              createdAt: new Date().toISOString(),
              source: 'manual',
            },
            ...state.movementHistory,
          ];
        }

        return { ...product, stock: afterStock, analyticsKey: getProductKey(product) };
      });

      return nextMovement
        ? {
            ...state,
            products,
            movements: [nextMovement, ...state.movements],
            movementHistory: nextHistory,
          }
        : state;
    }
    case 'COMPLETE_SALE': {
      const { items, paymentMethod, cashReceived, invoiceCustomer, invoiceDueDate, voucherLabel, note, terminalResult, tipAmount, email, unpaid, splitLegs, grossSubtotal, itemDiscountTotal, saleDiscountAmount, roundingAmount, payableTotal } = action.payload;
      const createdAt = new Date().toISOString();
      const lastToday = state.sales.filter((sale) => String(sale.documentNumber || '').startsWith(createdAt.slice(0, 10).replaceAll('-', ''))).length;
      const documentNumber = buildDocumentNumber(lastToday + 1, createdAt);
      const preparedItems = items.map((item) => {
        const priceWithVat = Number(item.priceWithVat ?? item.price) || 0;
        const vatRate = Number(item.vatRate) || 12;
        const quantity = Number(item.quantity) || 0;
        const priceWithoutVat = Number.isFinite(Number(item.priceWithoutVat)) ? Number(item.priceWithoutVat) : netFromGross(priceWithVat, vatRate);
        const lineGross = Number(item.lineGross) || priceWithVat * quantity;
        const lineDiscount = Number(item.lineDiscount) || 0;
        const lineTotal = Math.max(0, Number(item.lineTotal) || (lineGross - lineDiscount));
        const lineTotalWithoutVat = netFromGross(lineTotal, vatRate);
        const lineVatAmount = vatFromGross(lineTotal, vatRate);
        return {
          productId: item.productId,
          name: item.name,
          price: priceWithVat,
          priceWithVat,
          priceWithoutVat,
          originalPrice: Number(item.originalPrice) || priceWithVat,
          quantity,
          unit: item.unit,
          category: item.category || '',
          vatRate,
          discountType: item.discountType || 'amount',
          discountValue: Number(item.discountValue) || 0,
          lineGross,
          lineDiscount,
          lineTotal,
          lineTotalWithVat: lineTotal,
          lineTotalWithoutVat,
          lineVatAmount,
        };
      });
      const computedGrossSubtotal = preparedItems.reduce((sum, item) => sum + item.lineGross, 0);
      const computedItemDiscount = preparedItems.reduce((sum, item) => sum + item.lineDiscount, 0);
      const gross = Number(grossSubtotal) || computedGrossSubtotal;
      const itemDiscount = Number(itemDiscountTotal) || computedItemDiscount;
      const saleDiscount = Number(saleDiscountAmount) || 0;
      const subtotal = Math.max(0, gross - itemDiscount - saleDiscount);
      const vatBreakdown = buildVatBreakdown(preparedItems, saleDiscount);
      const subtotalWithoutVat = roundMoney(vatBreakdown.reduce((sum, row) => sum + row.base, 0));
      const vatTotal = roundMoney(vatBreakdown.reduce((sum, row) => sum + row.vat, 0));
      const tip = Number(tipAmount) || 0;
      const rounding = Number(roundingAmount) || 0;
      const total = Number.isFinite(Number(payableTotal)) ? Number(payableTotal) : Math.max(0, subtotal + tip + rounding);
      const received = Number(cashReceived) || 0;
      const change = paymentMethod === 'cash' ? Math.max(0, received - total) : 0;
      const movementEntries = [];
      const historyEntries = [];
      const products = state.products.map((product) => {
        const saleItem = preparedItems.find((item) => item.productId === product.id);
        if (!saleItem) return product;
        const beforeStock = Number(product.stock) || 0;
        const afterStock = beforeStock - saleItem.quantity;
        movementEntries.push({
          id: uid('m'),
          productId: product.id,
          productName: product.name,
          type: 'sale',
          quantity: saleItem.quantity,
          beforeStock,
          afterStock,
          note: `Prodej přes pokladnu · ${documentNumber}`,
          createdAt,
        });
        historyEntries.push({
          id: uid('h'),
          productId: product.id,
          analyticsKey: getProductKey(product),
          productName: product.name,
          category: product.category,
          type: 'sale',
          quantity: saleItem.quantity,
          createdAt,
          source: 'cashier',
        });
        return { ...product, stock: afterStock, analyticsKey: getProductKey(product) };
      });
      const activeCashSession = getOpenCashSession(state);
      const sale = {
        id: uid('s'),
        cashSessionId: activeCashSession?.id || '',
        documentNumber,
        createdAt,
        paymentMethod,
        grossSubtotal: gross,
        itemDiscountTotal: itemDiscount,
        saleDiscountAmount: saleDiscount,
        subtotal,
        subtotalWithoutVat,
        vatTotal,
        vatBreakdown,
        total,
        tipAmount: tip,
        roundingAmount: rounding,
        cashReceived: paymentMethod === 'cash' ? received : 0,
        change,
        invoiceCustomer: paymentMethod === 'invoice' ? String(invoiceCustomer || '').trim() : '',
        invoiceDueDate: paymentMethod === 'invoice' && invoiceDueDate ? invoiceDueDate : '',
        voucherLabel: paymentMethod === 'voucher' ? String(voucherLabel || '').trim() : '',
        note: String(note || '').trim(),
        email: String(email || '').trim(),
        unpaid: Boolean(unpaid),
        splitLegs: splitLegs || [],
        terminalProvider: terminalResult?.provider || '',
        terminalStatus: terminalResult?.status || '',
        terminalReference: terminalResult?.referenceId || '',
        terminalApprovalCode: terminalResult?.approvalCode || '',
        terminalDevice: terminalResult?.deviceLabel || '',
        items: preparedItems,
      };
      return {
        ...state,
        products,
        movements: [...movementEntries, ...state.movements],
        sales: [sale, ...state.sales],
        auditLog: [auditEntry('create', 'sale', sale.id, sale.documentNumber, { total: sale.total, paymentMethod: sale.paymentMethod }), ...state.auditLog],
        movementHistory: [...historyEntries, ...state.movementHistory],
      };
    }
    case 'ADD_SUPPLIER': {
      const name = String(action.payload.name || '').trim();
      if (!name) return state;
      if (state.suppliers.some((supplier) => normalizeText(supplier.name) === normalizeText(name))) return state;
      return {
        ...state,
        suppliers: [{ id: uid('sup'), name, createdAt: new Date().toISOString() }, ...state.suppliers],
      };
    }
    case 'UPDATE_SUPPLIER': {
      return {
        ...state,
        suppliers: state.suppliers.map((supplier) =>
          supplier.id === action.payload.id ? { ...supplier, ...action.payload } : supplier
        ),
      };
    }
    case 'SAVE_STOCK_RECEIPT_DRAFT': {
      return {
        ...state,
        suppliers: createSupplierIfMissing(state, action.payload?.supplierName),
        stockReceiptDraft: {
          ...action.payload,
          updatedAt: new Date().toISOString(),
        },
      };
    }
    case 'CLEAR_STOCK_RECEIPT_DRAFT': {
      return {
        ...state,
        stockReceiptDraft: null,
      };
    }
    case 'COMPLETE_STOCK_RECEIPT': {
      const receipt = action.payload;
      const itemMap = new Map(receipt.items.map((item) => [item.productId, item]));
      const receiptMovements = [];
      const products = state.products.map((product) => {
        const item = itemMap.get(product.id);
        if (!item) return product;
        const quantity = Number(item.quantity) || 0;
        if (quantity <= 0) return product;
        const beforeStock = Number(product.stock) || 0;
        const afterStock = beforeStock + quantity;
        const previousBase = Math.max(beforeStock, 0) * (Number(product.costPrice) || 0);
        const receiptBase = quantity * (Number(item.purchasePrice) || 0);
        const nextCostPrice = afterStock > 0 ? (previousBase + receiptBase) / (Math.max(beforeStock, 0) + quantity) : Number(product.costPrice) || 0;
        receiptMovements.push({
          id: uid('m'),
          productId: product.id,
          productName: product.name,
          type: 'receipt',
          quantity,
          beforeStock,
          afterStock,
          note: `${receipt.supplierName || 'Bez dodavatele'} · ${receipt.documentNumber || 'bez DL'}`,
          createdAt: receipt.stockedAt,
        });
        return {
          ...product,
          stock: afterStock,
          costPrice: Number.isFinite(nextCostPrice) ? nextCostPrice : product.costPrice,
          price: receipt.updateSalePrices && item.salePrice != null ? Number(item.salePrice) || product.price : product.price,
          analyticsKey: getProductKey(product),
        };
      });

      const totalCost = receipt.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.purchasePrice) || 0), 0);
      const storedReceipt = {
        ...receipt,
        id: receipt.id || uid('r'),
        status: 'completed',
        completedAt: new Date().toISOString(),
        totalItems: receipt.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
        totalCost,
      };

      return {
        ...state,
        products,
        movements: [...receiptMovements, ...state.movements],
        stockReceipts: [storedReceipt, ...state.stockReceipts],
        stockReceiptDraft: null,
        suppliers: createSupplierIfMissing(state, receipt.supplierName),
      };
    }
    case 'OPEN_CASH_REGISTER': {
      const existingOpen = getOpenCashSession(state);
      if (existingOpen) return state;
      const openedAt = new Date().toISOString();
      const session = {
        id: uid('cash'),
        businessDate: action.payload.businessDate || openedAt.slice(0, 10),
        openedAt,
        openedBy: String(action.payload.openedBy || '').trim(),
        openingCash: Number(action.payload.openingCash) || 0,
        openingCashBreakdown: action.payload.openingCashBreakdown || {},
        expectedOpeningCash: action.payload.expectedOpeningCash == null ? null : Number(action.payload.expectedOpeningCash) || 0,
        openingDifference: action.payload.openingDifference == null ? null : Number(action.payload.openingDifference) || 0,
        previousCashSessionId: String(action.payload.previousCashSessionId || ''),
        openingNote: String(action.payload.openingNote || '').trim(),
        status: 'open',
      };
      return {
        ...state,
        cashSessions: [session, ...(state.cashSessions || [])],
        auditLog: [auditEntry('open', 'cash_session', session.id, `Otevření pokladny ${session.businessDate}`, session), ...state.auditLog],
      };
    }
    case 'CLOSE_CASH_REGISTER': {
      const session = getOpenCashSession(state);
      if (!session) return state;
      const summary = summarizeCashSessionSales(state.sales, session);
      const countedCash = Number(action.payload.countedCash) || 0;
      const closed = {
        ...session,
        closedAt: new Date().toISOString(),
        closedBy: String(action.payload.closedBy || '').trim(),
        countedCash,
        closingCashBreakdown: action.payload.closingCashBreakdown || {},
        expectedCash: summary.expectedCash,
        cashDifference: countedCash - summary.expectedCash,
        totalCashSales: summary.totalCashSales,
        totalCard: summary.totalCard,
        totalTransfer: summary.totalTransfer,
        totalVoucher: summary.totalVoucher,
        totalRevenue: summary.totalRevenue,
        saleCount: summary.sales.filter((sale) => !sale.unpaid).length,
        unpaidCount: summary.sales.filter((sale) => sale.unpaid).length,
        closingNote: String(action.payload.closingNote || '').trim(),
        status: 'closed',
      };
      return {
        ...state,
        cashSessions: (state.cashSessions || []).map((item) => item.id === session.id ? closed : item),
        auditLog: [auditEntry('close', 'cash_session', closed.id, `Zavření pokladny ${closed.businessDate}`, closed), ...state.auditLog],
      };
    }


    case 'ADD_PARKED_TICKET': {
      const ticket = normalizeParkedTicket(action.payload, `Účet ${(state.parkedTickets || []).length + 1}`);
      return {
        ...state,
        parkedTickets: [...(state.parkedTickets || []), ticket],
      };
    }
    case 'RENAME_PARKED_TICKET': {
      const name = String(action.payload?.name || '').trim();
      if (!name) return state;
      return {
        ...state,
        parkedTickets: (state.parkedTickets || []).map((ticket) =>
          ticket.id === action.payload.id ? { ...ticket, name, updatedAt: new Date().toISOString() } : ticket
        ),
      };
    }
    case 'UPDATE_PARKED_TICKET_ITEMS': {
      const meta = action.payload.meta || {};
      return {
        ...state,
        parkedTickets: (state.parkedTickets || []).map((ticket) =>
          ticket.id === action.payload.id
            ? {
                ...ticket,
                ...meta,
                items: Array.isArray(action.payload.items) ? action.payload.items : [],
                discountMode: meta.discountMode || ticket.discountMode || 'amount',
                discountValue: meta.discountValue ?? ticket.discountValue ?? 0,
                updatedAt: new Date().toISOString(),
              }
            : ticket
        ),
      };
    }
    case 'DELETE_PARKED_TICKET': {
      return {
        ...state,
        parkedTickets: (state.parkedTickets || []).filter((ticket) => ticket.id !== action.payload.id),
      };
    }

    case 'CLOSE_DAY': {
      const closure = {
        id: uid('close'),
        businessDate: action.payload.businessDate || new Date().toISOString().slice(0, 10),
        closedAt: new Date().toISOString(),
        expectedCash: Number(action.payload.expectedCash) || 0,
        countedCash: Number(action.payload.countedCash) || 0,
        cashDifference: (Number(action.payload.countedCash) || 0) - (Number(action.payload.expectedCash) || 0),
        totalCash: Number(action.payload.totalCash) || 0,
        totalCard: Number(action.payload.totalCard) || 0,
        totalTransfer: Number(action.payload.totalTransfer) || 0,
        totalVoucher: Number(action.payload.totalVoucher) || 0,
        totalRevenue: Number(action.payload.totalRevenue) || 0,
        note: String(action.payload.note || '').trim(),
      };
      return {
        ...state,
        dayClosures: [closure, ...state.dayClosures],
        auditLog: [auditEntry('create', 'day_closure', closure.id, `Uzávěrka ${closure.businessDate}`, closure), ...state.auditLog],
      };
    }
    case 'RESET_DEMO': {
      return resetState();
    }
    default:
      return state;
  }
}

function getOutflowByWindow(product, movementHistory, windowDays) {
  const cutoff = Date.now() - windowDays * DAY_MS;
  const key = getProductKey(product);
  const quantity = movementHistory
    .filter((row) => row.analyticsKey === key)
    .filter((row) => ['sale', 'writeoff'].includes(row.type))
    .filter((row) => new Date(row.createdAt).getTime() >= cutoff)
    .reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  return quantity / windowDays;
}

function classifyDays(currentStock, weightedDailyOutflow) {
  if (currentStock <= 0) {
    return { label: 'K naskladnění', tone: 'warning-badge', bucket: 'audit' };
  }
  if (weightedDailyOutflow <= 0) {
    return { label: 'Bez dat', tone: '', bucket: 'unknown' };
  }
  const daysToZero = currentStock / weightedDailyOutflow;
  if (daysToZero <= 3) return { label: 'Do 3 dnů', tone: 'danger-badge', bucket: 'd3' };
  if (daysToZero <= 7) return { label: 'Do 7 dnů', tone: 'warning-badge', bucket: 'd7' };
  if (daysToZero <= 14) return { label: 'Do 14 dnů', tone: 'accent-badge', bucket: 'd14' };
  return { label: 'Stabilní', tone: '', bucket: 'stable' };
}

function getInventoryAnalytics(products, movementHistory) {
  const totalStockValue = products.reduce((sum, product) => sum + (Number(product.stock) || 0) * (Number(product.costPrice) || 0), 0);
  const zeroStockCount = products.filter((product) => (Number(product.stock) || 0) === 0).length;
  const negativeStockCount = products.filter((product) => (Number(product.stock) || 0) < 0).length;

  const stockoutForecasts = products
    .filter((product) => !product.hidden)
    .map((product) => {
      const avgDaily28 = getOutflowByWindow(product, movementHistory, 28);
      const avgDaily56 = getOutflowByWindow(product, movementHistory, 56);
      const weightedDailyOutflow = avgDaily28 > 0 ? avgDaily28 * 0.65 + avgDaily56 * 0.35 : avgDaily56;
      const currentStock = Number(product.stock) || 0;
      const daysToZero = weightedDailyOutflow > 0 && currentStock > 0 ? currentStock / weightedDailyOutflow : null;
      const status = classifyDays(currentStock, weightedDailyOutflow);
      return {
        productId: product.id,
        productName: product.name,
        category: product.category || 'Nezařazeno',
        currentStock,
        stockValue: currentStock * (Number(product.costPrice) || 0),
        avgDaily28,
        avgDaily56,
        weightedDailyOutflow,
        daysToZero,
        statusLabel: status.label,
        statusTone: status.tone,
        statusBucket: status.bucket,
        analyticsKey: getProductKey(product),
      };
    })
    .sort((a, b) => {
      const aRank = a.statusBucket === 'audit' ? -1 : a.daysToZero ?? Number.POSITIVE_INFINITY;
      const bRank = b.statusBucket === 'audit' ? -1 : b.daysToZero ?? Number.POSITIVE_INFINITY;
      return aRank - bRank;
    });

  const categoryMap = new Map();
  stockoutForecasts.forEach((item) => {
    const current = categoryMap.get(item.category) || {
      category: item.category,
      productCount: 0,
      stockValue: 0,
      auditCount: 0,
      soonCount: 0,
    };
    current.productCount += 1;
    current.stockValue += item.stockValue;
    if (item.statusBucket === 'audit') current.auditCount += 1;
    if (['d3', 'd7', 'd14'].includes(item.statusBucket)) current.soonCount += 1;
    categoryMap.set(item.category, current);
  });

  return {
    totalStockValue,
    zeroStockCount,
    negativeStockCount,
    noHistoryCount: stockoutForecasts.filter((item) => item.weightedDailyOutflow <= 0 && item.currentStock > 0).length,
    stockoutForecasts,
    auditQueue: stockoutForecasts.filter((item) => item.statusBucket === 'audit'),
    dueIn3: stockoutForecasts.filter((item) => item.statusBucket === 'd3'),
    dueIn7: stockoutForecasts.filter((item) => item.statusBucket === 'd7'),
    dueIn14: stockoutForecasts.filter((item) => item.statusBucket === 'd14'),
    topVelocity: [...stockoutForecasts].sort((a, b) => b.weightedDailyOutflow - a.weightedDailyOutflow).slice(0, 12),
    topByValue: [...stockoutForecasts].sort((a, b) => b.stockValue - a.stockValue).slice(0, 12),
    categorySummary: [...categoryMap.values()].sort((a, b) => b.stockValue - a.stockValue),
  };
}

export function usePosStore() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);
  const [syncStatus, setSyncStatus] = useState({ mode: getSyncModeLabel(), state: supabaseConfigured ? 'loading' : 'local', message: supabaseConfigured ? 'Načítám data ze Supabase…' : 'Lokální data připravena.' });
  const [remoteReady, setRemoteReady] = useState(!supabaseConfigured);
  const [remoteLoadOk, setRemoteLoadOk] = useState(!supabaseConfigured);
  const remoteLoadedRef = useRef(false);
  const remoteLoadSucceededRef = useRef(false);
  const pendingLocalWriteRef = useRef(false);
  const lastLocalChangeAtRef = useRef(0);

  const markLocalChange = () => {
    pendingLocalWriteRef.current = true;
    lastLocalChangeAtRef.current = Date.now();
  };

  const dispatchLocal = (action) => {
    markLocalChange();
    dispatch(action);
  };

  useEffect(() => {
    let cancelled = false;
    loadRemoteState()
      .then((remoteState) => {
        if (cancelled) return;
        remoteLoadedRef.current = true;
        remoteLoadSucceededRef.current = true;
        setRemoteReady(true);
        setRemoteLoadOk(true);
        if (remoteState) {
          dispatch({ type: 'HYDRATE_REMOTE', payload: remoteState });
          setSyncStatus({ mode: getSyncModeLabel(), state: 'online', message: 'Načteno ze Supabase.' });
        }
      })
      .catch((error) => {
        remoteLoadedRef.current = true;
        remoteLoadSucceededRef.current = false;
        setRemoteReady(true);
        setRemoteLoadOk(false);
        setSyncStatus({ mode: getSyncModeLabel(), state: 'error', message: error.message || 'Supabase načtení selhalo. Ukládání do Supabase je pozastavené, aby se nepřepsala data.' });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!remoteLoadedRef.current || !remoteLoadSucceededRef.current) return;
      if (pendingLocalWriteRef.current) return;

      const requestedAt = Date.now();
      loadRemoteState()
        .then((remoteState) => {
          // Do not let a remote read that started before a local import/edit overwrite
          // the fresh local state. The next successful sync makes Supabase current and
          // then remote polling can resume safely.
          if (pendingLocalWriteRef.current || requestedAt < lastLocalChangeAtRef.current) return;
          if (remoteState) {
            dispatch({ type: 'HYDRATE_REMOTE', payload: remoteState });
            setSyncStatus({ mode: getSyncModeLabel(), state: 'online', message: 'Načteno ze Supabase.' });
          }
        })
        .catch((error) => {
          remoteLoadSucceededRef.current = false;
          setRemoteLoadOk(false);
          setSyncStatus({ mode: getSyncModeLabel(), state: 'error', message: error.message || 'Supabase načtení selhalo. Ukládání do Supabase je pozastavené.' });
        });
    }, 8000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    saveState(state);
    const timeout = window.setTimeout(() => {
      if (!remoteLoadedRef.current || !remoteLoadSucceededRef.current) return;
      syncStateToSupabase(state)
        .then((result) => {
          if (result?.skipped) {
            setSyncStatus({ mode: getSyncModeLabel(), state: 'local', message: 'Ukládám lokálně. Supabase není nastavený.' });
            return;
          }
          pendingLocalWriteRef.current = false;
          setSyncStatus({ mode: getSyncModeLabel(), state: 'online', message: 'Synchronizováno se Supabase.' });
        })
        .catch((error) => {
          setSyncStatus({ mode: getSyncModeLabel(), state: 'error', message: error.message || 'Supabase sync selhal.' });
        });
    }, remoteLoadedRef.current ? 700 : 1500);
    return () => window.clearTimeout(timeout);
  }, [state]);

  const derived = useMemo(() => {
    const visibleProducts = state.products.filter((product) => !product.hidden);
    const categories = ['Vše', ...new Set(visibleProducts.map((product) => product.category).filter(Boolean))];

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + (now.getDay()===0?-6:1)); weekStart.setHours(0,0,0,0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const paidSales = state.sales.filter(s => !s.unpaid);
    const todaySales = paidSales.filter(s => new Date(s.createdAt) >= todayStart);
    const weekSales  = paidSales.filter(s => new Date(s.createdAt) >= weekStart);
    const monthSales = paidSales.filter(s => new Date(s.createdAt) >= monthStart);
    const yearSales  = paidSales.filter(s => new Date(s.createdAt) >= yearStart);

    const sumRevenue = (arr) => arr.reduce((s,x)=>s+x.total,0);
    const todayRevenue = sumRevenue(todaySales);
    const weekRevenue  = sumRevenue(weekSales);
    const monthRevenue = sumRevenue(monthSales);
    const yearRevenue  = sumRevenue(yearSales);

    // Payment method breakdown (this month)
    const paymentBreakdown = {};
    for (const s of monthSales) {
      const m = s.paymentMethod || 'other';
      paymentBreakdown[m] = (paymentBreakdown[m] || 0) + s.total;
    }

    // DPH breakdown (this month) — simplified: 21% on all until product-level tax is added
    const vatBreakdown = { '0%': 0, '12%': 0, '21%': 0 };
    for (const s of monthSales) {
      for (const item of (s.items||[])) {
        const vat = Number(item.vatRate) || 12;
        const key = vat === 0 ? '0%' : vat === 21 ? '21%' : '12%';
        vatBreakdown[key] = (vatBreakdown[key]||0) + (Number(item.lineTotalWithoutVat) || netFromGross((Number(item.lineTotal) || Number(item.price) * Number(item.quantity)), vat));
      }
    }

    // Total stock value
    const totalStockValue = state.products.reduce((sum,p) => sum + (Number(p.stock)||0)*(Number(p.costPrice)||0), 0);

    const inventory = getInventoryAnalytics(state.products, state.movementHistory);
    const daysToZeroMap = Object.fromEntries(inventory.stockoutForecasts.map((item) => [item.productId, item]));

    // Hourly sales for chart (today)
    const hourlyRevenue = Array(24).fill(0);
    for (const s of todaySales) {
      const h = new Date(s.createdAt).getHours();
      hourlyRevenue[h] += s.total;
    }

    // Daily for this week
    const weekDayRevenue = Array(7).fill(0); // 0=Mon..6=Sun
    for (const s of weekSales) {
      const d = new Date(s.createdAt).getDay();
      const idx = d===0?6:d-1;
      weekDayRevenue[idx] += s.total;
    }

    return {
      visibleProducts,
      categories,
      todaySalesCount: todaySales.length,
      weekSalesCount: weekSales.length,
      monthSalesCount: monthSales.length,
      todayRevenue,
      weekRevenue,
      monthRevenue,
      yearRevenue,
      paymentBreakdown,
      vatBreakdown,
      totalStockValue,
      hourlyRevenue,
      weekDayRevenue,
      inventory,
      daysToZeroMap,
      supplierCount: state.suppliers.length,
      latestReceipts: state.stockReceipts.slice(0, 8),
      activeCashSession: getOpenCashSession(state),
      activeCashSessionSummary: summarizeCashSessionSales(state.sales, getOpenCashSession(state)),
    };
  }, [state]);

  return {
    state,
    derived,
    syncStatus,
    remoteReady,
    remoteLoadOk,
    addProduct: (payload) => dispatchLocal({ type: 'ADD_PRODUCT', payload }),
    updateProduct: (payload) => dispatchLocal({ type: 'UPDATE_PRODUCT', payload }),
    importStockSnapshot: (products, fileName) => dispatchLocal({ type: 'IMPORT_STOCK_SNAPSHOT', payload: { products, fileName } }),
    importDotykackaCsv: (products, fileName) => dispatchLocal({ type: 'IMPORT_DOTYKACKA_CSV', payload: { products, fileName } }),
    importMovementHistory: (rows, fileName) => dispatchLocal({ type: 'IMPORT_MOVEMENT_HISTORY', payload: { rows, fileName } }),
    applyStockMovement: (payload) => dispatchLocal({ type: 'APPLY_STOCK_MOVEMENT', payload }),
    completeSale: (payload) => dispatchLocal({ type: 'COMPLETE_SALE', payload }),
    addSupplier: (payload) => dispatchLocal({ type: 'ADD_SUPPLIER', payload }),
    updateSupplier: (payload) => dispatchLocal({ type: 'UPDATE_SUPPLIER', payload }),
    saveStockReceiptDraft: (payload) => dispatchLocal({ type: 'SAVE_STOCK_RECEIPT_DRAFT', payload }),
    clearStockReceiptDraft: () => dispatchLocal({ type: 'CLEAR_STOCK_RECEIPT_DRAFT' }),
    completeStockReceipt: (payload) => dispatchLocal({ type: 'COMPLETE_STOCK_RECEIPT', payload }),
    openCashRegister: (payload) => dispatchLocal({ type: 'OPEN_CASH_REGISTER', payload }),
    closeCashRegister: (payload) => dispatchLocal({ type: 'CLOSE_CASH_REGISTER', payload }),
    closeDay: (payload) => dispatchLocal({ type: 'CLOSE_DAY', payload }),
    addParkedTicket: (payload) => dispatchLocal({ type: 'ADD_PARKED_TICKET', payload }),
    renameParkedTicket: (id, name) => dispatchLocal({ type: 'RENAME_PARKED_TICKET', payload: { id, name } }),
    updateParkedTicketItems: (id, items, meta = {}) => dispatchLocal({ type: 'UPDATE_PARKED_TICKET_ITEMS', payload: { id, items, meta } }),
    deleteParkedTicket: (id) => dispatchLocal({ type: 'DELETE_PARKED_TICKET', payload: { id } }),
    resetDemo: () => dispatchLocal({ type: 'RESET_DEMO' }),
  };
}

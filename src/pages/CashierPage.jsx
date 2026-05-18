import { useEffect, useMemo, useRef, useState } from 'react';
import { PaymentDialog } from '../components/PaymentDialog';
import { formatCurrency, formatQuantity } from '../lib/format';
import { formatUnitLabel, getDefaultSaleQuantity, getQuantityStep, isWeightUnit, normalizeCartQuantity, sanitizePositiveQuantity } from '../lib/productUnits';
import { printSaleDocument } from '../lib/receiptPrint';
import { CashCountForm, getCashBreakdownTotal, normalizeCashBreakdown } from '../components/CashCountForm';
import { getCategoryMeta, getProductMeta, sortCategories, sortProductsForCatalog } from '../lib/catalogPresentation';
import { netFromGross, vatFromGross } from '../lib/vat';

function createTicket(name = 'Účet 1') {
  const now = new Date().toISOString();
  const id = `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, name, items: [], discountMode: 'amount', discountValue: 0, createdAt: now, updatedAt: now, status: 'open' };
}

function buildDocumentNumber(sequence, createdAt) {
  const date = new Date(createdAt);
  const prefix = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampDiscount(value, max) {
  return Math.min(Math.max(parseNumber(value), 0), Math.max(max, 0));
}

function createCartItem(product, quantity = getDefaultSaleQuantity(product.unit)) {
  return {
    productId: product.id,
    name: product.name,
    price: Number(product.priceWithVat ?? product.price) || 0,
    priceWithVat: Number(product.priceWithVat ?? product.price) || 0,
    priceWithoutVat: Number(product.priceWithoutVat) || netFromGross(product.priceWithVat ?? product.price, product.vatRate),
    originalPrice: Number(product.priceWithVat ?? product.price) || 0,
    unit: product.unit,
    category: product.category || '',
    vatRate: Number(product.vatRate) || 12,
    quantity: sanitizePositiveQuantity(quantity, product.unit),
    discountType: 'amount',
    discountValue: 0,
  };
}

function getLineGross(item) {
  return (Number(item.price) || 0) * (Number(item.quantity) || 0);
}

function getLineDiscountAmount(item) {
  const gross = getLineGross(item);
  const raw = Number(item.discountValue) || 0;
  if (raw <= 0 || gross <= 0) return 0;
  if (item.discountType === 'percent') return clampDiscount((gross * raw) / 100, gross);
  return clampDiscount(raw, gross);
}

function getLineTotal(item) {
  return Math.max(0, getLineGross(item) - getLineDiscountAmount(item));
}

function getItemsSubtotal(items) {
  return items.reduce((sum, item) => sum + getLineGross(item), 0);
}

function getItemDiscountTotal(items) {
  return items.reduce((sum, item) => sum + getLineDiscountAmount(item), 0);
}

function getTicketBaseAfterItemDiscounts(items) {
  return Math.max(0, getItemsSubtotal(items) - getItemDiscountTotal(items));
}

function getOrderDiscountAmount(ticket, items) {
  const base = getTicketBaseAfterItemDiscounts(items);
  const raw = Number(ticket?.discountValue) || 0;
  if (raw <= 0 || base <= 0) return 0;
  if (ticket?.discountMode === 'percent') return clampDiscount((base * raw) / 100, base);
  return clampDiscount(raw, base);
}

function getTicketTotal(ticket) {
  const items = ticket?.items || [];
  return Math.max(0, getTicketBaseAfterItemDiscounts(items) - getOrderDiscountAmount(ticket, items));
}

function prepareSaleItems(items) {
  return items.map((item) => {
    const lineGross = getLineGross(item);
    const lineDiscount = getLineDiscountAmount(item);
    return {
      ...item,
      price: Number(item.priceWithVat ?? item.price) || 0,
      priceWithVat: Number(item.priceWithVat ?? item.price) || 0,
      priceWithoutVat: Number(item.priceWithoutVat) || netFromGross(item.priceWithVat ?? item.price, item.vatRate),
      quantity: Number(item.quantity) || 0,
      discountType: item.discountType || 'amount',
      discountValue: Number(item.discountValue) || 0,
      lineGross,
      lineDiscount,
      lineTotal: Math.max(0, lineGross - lineDiscount),
      lineTotalWithVat: Math.max(0, lineGross - lineDiscount),
      lineTotalWithoutVat: netFromGross(Math.max(0, lineGross - lineDiscount), item.vatRate),
      lineVatAmount: vatFromGross(Math.max(0, lineGross - lineDiscount), item.vatRate),
    };
  });
}

export function CashierPage({ products, categories, nextDocumentSequence, activeCashSession, cashSessions = [], parkedTickets = [], onOpenCashRegister, onCompleteSale, onAddParkedTicket, onRenameParkedTicket, onUpdateParkedTicketItems, onDeleteParkedTicket }) {
  const [selectedCategory, setSelectedCategory] = useState('Vše');
  const [search, setSearch] = useState('');
  const tickets = parkedTickets;
  const [activeTicketId, setActiveTicketId] = useState(() => parkedTickets[0]?.id || '');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [lastPrintableSale, setLastPrintableSale] = useState(null);
  const [openingBreakdown, setOpeningBreakdown] = useState({});
  const [openedBy, setOpenedBy] = useState('');
  const [openingNote, setOpeningNote] = useState('');
  const [weightProduct, setWeightProduct] = useState(null);
  const [weightQuantity, setWeightQuantity] = useState('');
  const [editingItemId, setEditingItemId] = useState('');
  const [productInfoProduct, setProductInfoProduct] = useState(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressProductIdRef = useRef('');
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const longPressDidTriggerRef = useRef(false);

  const clearProductPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearProductPressTimer(), []);

  useEffect(() => {
    if (!tickets.length && onAddParkedTicket) {
      const freshTicket = createTicket('Účet 1');
      onAddParkedTicket(freshTicket);
      setActiveTicketId(freshTicket.id);
    }
  }, [tickets.length, onAddParkedTicket]);

  useEffect(() => {
    if (tickets.length > 0 && !tickets.some((ticket) => ticket.id === activeTicketId)) {
      setActiveTicketId(tickets[0].id);
    }
  }, [tickets, activeTicketId]);

  const activeTicket = tickets.find((ticket) => ticket.id === activeTicketId) || tickets[0] || createTicket();
  const cart = activeTicket.items || [];
  const editingItem = cart.find((item) => item.productId === editingItemId) || null;

  const updateActiveTicket = (patch) => {
    const currentTicket = tickets.find((ticket) => ticket.id === activeTicketId) || tickets[0];
    if (!currentTicket) return;
    const nextTicket = { ...currentTicket, ...patch, updatedAt: new Date().toISOString() };
    // Reuse rename/items callbacks so older store versions still work.
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) onRenameParkedTicket?.(currentTicket.id, nextTicket.name);
    if (Object.prototype.hasOwnProperty.call(patch, 'items')) onUpdateParkedTicketItems?.(currentTicket.id, nextTicket.items);
    if (Object.prototype.hasOwnProperty.call(patch, 'discountMode') || Object.prototype.hasOwnProperty.call(patch, 'discountValue')) {
      onUpdateParkedTicketItems?.(currentTicket.id, currentTicket.items || [], { discountMode: nextTicket.discountMode, discountValue: nextTicket.discountValue });
    }
  };

  const updateActiveTicketItems = (updater) => {
    const currentTicket = tickets.find((ticket) => ticket.id === activeTicketId) || tickets[0];
    if (!currentTicket || !onUpdateParkedTicketItems) return;
    const currentItems = currentTicket.items || [];
    const nextItems = typeof updater === 'function' ? updater(currentItems) : updater;
    onUpdateParkedTicketItems(currentTicket.id, nextItems);
  };

  const updateActiveTicketDiscount = (patch) => {
    const currentTicket = tickets.find((ticket) => ticket.id === activeTicketId) || tickets[0];
    if (!currentTicket || !onUpdateParkedTicketItems) return;
    onUpdateParkedTicketItems(currentTicket.id, currentTicket.items || [], {
      discountMode: patch.discountMode ?? currentTicket.discountMode ?? 'amount',
      discountValue: patch.discountValue ?? currentTicket.discountValue ?? 0,
    });
  };


  const chooseCategory = (category) => {
    setSelectedCategory(category);
    setCategoryPickerOpen(false);
  };

  const orderedCategories = useMemo(() => sortCategories(categories), [categories]);
  const orderedProducts = useMemo(() => sortProductsForCatalog(products), [products]);

  const filteredProducts = useMemo(() => {
    return orderedProducts.filter((product) => {
      const matchesCategory = selectedCategory === 'Vše' || product.category === selectedCategory;
      const haystack = `${product.name} ${product.barcode} ${product.plu} ${product.category}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [orderedProducts, search, selectedCategory]);

  const productVisuals = useMemo(() => {
    const groupCounts = new Map();
    return Object.fromEntries(
      filteredProducts.map((product) => {
        const meta = getProductMeta(product, groupCounts.get(`${product.category}::${product.name}`) || 0);
        const familyKey = `${product.category}::${meta.family}`;
        const nextIndex = groupCounts.get(familyKey) || 0;
        groupCounts.set(familyKey, nextIndex + 1);
        return [product.id, getProductMeta(product, nextIndex)];
      })
    );
  }, [filteredProducts]);

  const lastClosedCashSession = useMemo(() => {
    return [...cashSessions]
      .filter((session) => session.closedAt)
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())[0] || null;
  }, [cashSessions]);
  const openingCash = getCashBreakdownTotal(openingBreakdown);
  const previousClosingCash = lastClosedCashSession ? Number(lastClosedCashSession.countedCash ?? lastClosedCashSession.expectedCash ?? 0) || 0 : 0;
  const openingDifference = lastClosedCashSession ? openingCash - previousClosingCash : 0;

  const subtotalBeforeDiscounts = getItemsSubtotal(cart);
  const itemDiscountTotal = getItemDiscountTotal(cart);
  const ticketDiscountAmount = getOrderDiscountAmount(activeTicket, cart);
  const total = getTicketTotal(activeTicket);
  const totalDiscount = itemDiscountTotal + ticketDiscountAmount;

  const getQuantityOnOpenTickets = (productId) => tickets.reduce((sum, ticket) => {
    return sum + (ticket.items || []).reduce((ticketSum, item) => {
      return item.productId === productId ? ticketSum + (Number(item.quantity) || 0) : ticketSum;
    }, 0);
  }, 0);

  const addProductWithQuantity = (product, quantity) => {
    updateActiveTicketItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      const normalizedQuantity = sanitizePositiveQuantity(quantity, product.unit);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: normalizeCartQuantity((Number(item.quantity) || 0) + normalizedQuantity, item.unit) }
            : item
        );
      }
      return [...current, createCartItem(product, normalizedQuantity)];
    });
  };

  const addToCart = (product) => {
    if (isWeightUnit(product.unit)) {
      setWeightProduct(product);
      setWeightQuantity('');
      return;
    }
    addProductWithQuantity(product, getDefaultSaleQuantity(product.unit));
  };

  const cancelProductPress = () => {
    clearProductPressTimer();
    longPressProductIdRef.current = '';
    longPressDidTriggerRef.current = false;
  };

  const startProductPress = (product, event) => {
    if (event?.button && event.button !== 0) return;
    clearProductPressTimer();
    longPressProductIdRef.current = product.id;
    longPressDidTriggerRef.current = false;
    pointerStartRef.current = { x: event?.clientX || 0, y: event?.clientY || 0 };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressDidTriggerRef.current = true;
      longPressProductIdRef.current = '';
      setProductInfoProduct(product);
    }, 650);
  };

  const moveProductPress = (event) => {
    if (!longPressProductIdRef.current) return;
    const dx = Math.abs((event?.clientX || 0) - pointerStartRef.current.x);
    const dy = Math.abs((event?.clientY || 0) - pointerStartRef.current.y);
    if (dx > 14 || dy > 14) cancelProductPress();
  };

  const finishProductPress = (product) => {
    const shouldAdd = longPressProductIdRef.current === product.id && !longPressDidTriggerRef.current;
    clearProductPressTimer();
    longPressProductIdRef.current = '';
    if (shouldAdd) addToCart(product);
    window.setTimeout(() => { longPressDidTriggerRef.current = false; }, 0);
  };

  const openProductInfo = (product, event) => {
    event?.preventDefault?.();
    cancelProductPress();
    setProductInfoProduct(product);
  };

  const addProductFromInfo = () => {
    if (!productInfoProduct) return;
    if (isWeightUnit(productInfoProduct.unit)) {
      setWeightProduct(productInfoProduct);
      setWeightQuantity('');
    } else {
      addProductWithQuantity(productInfoProduct, getDefaultSaleQuantity(productInfoProduct.unit));
    }
    setProductInfoProduct(null);
  };

  const confirmWeightProduct = () => {
    if (!weightProduct) return;
    const quantity = sanitizePositiveQuantity(weightQuantity, weightProduct.unit);
    addProductWithQuantity(weightProduct, quantity);
    setWeightProduct(null);
    setWeightQuantity('');
  };

  const setQuantity = (productId, rawValue) => {
    updateActiveTicketItems((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) return item;
          return { ...item, quantity: normalizeCartQuantity(rawValue, item.unit) };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const updateCartItem = (productId, patch) => {
    updateActiveTicketItems((current) =>
      current
        .map((item) => item.productId === productId ? { ...item, ...patch } : item)
        .filter((item) => (Number(item.quantity) || 0) > 0)
    );
  };

  const removeCartItem = (productId) => {
    updateActiveTicketItems((current) => current.filter((item) => item.productId !== productId));
    setEditingItemId('');
  };

  const adjustQuantity = (productId, direction) => {
    updateActiveTicketItems((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) return item;
          const step = getQuantityStep(item.unit);
          return { ...item, quantity: normalizeCartQuantity(item.quantity + direction * step, item.unit) };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const clearCart = () => {
    updateActiveTicketItems([]);
    updateActiveTicketDiscount({ discountValue: 0 });
  };

  const createNewTicket = () => {
    const nextName = `Účet ${tickets.length + 1}`;
    const name = window.prompt('Název nového účtu', nextName) || nextName;
    const ticket = createTicket(name.trim() || nextName);
    onAddParkedTicket?.(ticket);
    setActiveTicketId(ticket.id);
  };

  const renameActiveTicket = () => {
    const nextName = window.prompt('Název účtu', activeTicket.name || 'Účet');
    if (!nextName) return;
    onRenameParkedTicket?.(activeTicket.id, nextName.trim() || activeTicket.name);
  };

  const closeEmptyTicket = (ticketId) => {
    const ticket = tickets.find((item) => item.id === ticketId);
    if (!ticket || (ticket.items || []).length > 0 || tickets.length <= 1) return;
    const nextTicket = tickets.find((item) => item.id !== ticketId);
    onDeleteParkedTicket?.(ticketId);
    if (activeTicketId === ticketId) setActiveTicketId(nextTicket?.id || '');
  };

  const removePaidTicket = () => {
    const nextTickets = tickets.filter((ticket) => ticket.id !== activeTicket.id);
    onDeleteParkedTicket?.(activeTicket.id);
    if (nextTickets.length === 0) {
      const freshTicket = createTicket('Účet 1');
      onAddParkedTicket?.(freshTicket);
      setActiveTicketId(freshTicket.id);
      return;
    }
    setActiveTicketId(nextTickets[0].id);
  };

  const parkedTotal = tickets.reduce((sum, ticket) => sum + getTicketTotal(ticket), 0);

  const handleCompleteSale = (payment) => {
    const createdAt = new Date().toISOString();
    const saleItems = prepareSaleItems(cart);
    const saleDiscountAmount = ticketDiscountAmount;
    const receiptPayload = {
      createdAt,
      documentNumber: buildDocumentNumber(nextDocumentSequence || 1, createdAt),
      items: saleItems,
      grossSubtotal: subtotalBeforeDiscounts,
      itemDiscountTotal,
      saleDiscountAmount,
      subtotal: total,
      total: Number(payment.payableTotal ?? (total + (Number(payment.tipAmount) || 0))) || 0,
      tipAmount: payment.tipAmount || 0,
      roundingAmount: Number(payment.roundingAmount) || 0,
      paymentMethod: payment.paymentMethod,
      cashReceived: payment.paymentMethod === 'cash' ? Number(payment.cashReceived) || 0 : 0,
      change: payment.paymentMethod === 'cash' ? Number(payment.change) || 0 : 0,
      invoiceCustomer: payment.invoiceCustomer,
      invoiceDueDate: payment.invoiceDueDate,
      voucherLabel: payment.voucherLabel,
      note: payment.note,
    };

    onCompleteSale({ items: saleItems, grossSubtotal: subtotalBeforeDiscounts, itemDiscountTotal, saleDiscountAmount, ...payment });
    if (!payment.unpaid) {
      setLastPrintableSale(receiptPayload);
    }
    if (payment.printReceipt && !payment.unpaid) {
      printSaleDocument(receiptPayload);
    }
    removePaidTicket();
    setPaymentOpen(false);
  };

  const handleOpenCashRegister = () => {
    if (!onOpenCashRegister) return;
    onOpenCashRegister({
      businessDate: new Date().toISOString().slice(0, 10),
      openingCash,
      openingCashBreakdown: normalizeCashBreakdown(openingBreakdown),
      expectedOpeningCash: lastClosedCashSession ? previousClosingCash : null,
      openingDifference: lastClosedCashSession ? openingDifference : null,
      previousCashSessionId: lastClosedCashSession?.id || '',
      openedBy,
      openingNote,
    });
    setOpeningBreakdown({});
    setOpenedBy('');
    setOpeningNote('');
  };

  if (!activeCashSession) {
    return (
      <div className="page-stack cashier-layout">
        <section className="page-header">
          <div>
            <h1>Pokladna</h1>
            <p className="muted">Nejdřív je potřeba otevřít pokladnu a zadat počáteční hotovost v kase.</p>
          </div>
        </section>
        <section className="card soft-card stack compact">
          <h2>Otevření pokladny</h2>
          <p className="muted">Spočítej hotovost v kase před prvním prodejem. Zadej počet jednotlivých bankovek a mincí; systém spočítá celkem a porovná stav s posledním zavřením.</p>
          {lastClosedCashSession ? (
            <div className="inner-card">
              <div className="list-row"><span>Hotovost při posledním zavření</span><strong>{formatCurrency(previousClosingCash)}</strong></div>
              <div className="list-row">
                <span>Rozdíl proti dnešnímu přepočtu</span>
                <strong style={{color: openingDifference === 0 ? 'var(--text)' : openingDifference < 0 ? 'var(--danger)' : 'var(--warning)'}}>
                  {formatCurrency(openingDifference)} {openingDifference < 0 ? '· manko' : openingDifference > 0 ? '· přebytek' : '· sedí'}
                </strong>
              </div>
            </div>
          ) : <p className="muted">Zatím není uložené žádné předchozí zavření. První otevření nebude s čím porovnat.</p>}
          <CashCountForm title="Počáteční hotovost v kase" value={openingBreakdown} onChange={setOpeningBreakdown} />
          <div className="form-grid">
            <label>Otevřel/a
              <input value={openedBy} onChange={(e) => setOpenedBy(e.target.value)} placeholder="jméno obsluhy" />
            </label>
            <label>Poznámka
              <input value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} placeholder="např. důvod rozdílu" />
            </label>
          </div>
          <button className="primary-button" onClick={handleOpenCashRegister}>Otevřít pokladnu s {formatCurrency(openingCash)}</button>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack cashier-layout">
      <section className="page-header cashier-page-header">
        <div>
          <h1>Pokladna</h1>
          <p className="muted">Kompaktní režim pro rychlé markování. Účty jsou nahoře v liště a sdílí se přes Supabase.</p>
          <p className="muted">Pokladna otevřena od {new Date(activeCashSession.openedAt).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'})} · počáteční hotovost {formatCurrency(activeCashSession.openingCash || 0)}</p>
        </div>
      </section>

      <section className="ticket-bar card compact-card sticky-ticket-bar">
        <div className="ticket-bar-title">
          <strong>Otevřené účty</strong>
          <span className="badge accent-badge">{tickets.length}</span>
        </div>
        <div className="ticket-tabs">
          {tickets.map((ticket) => {
            const ticketTotal = getTicketTotal(ticket);
            const itemCount = (ticket.items || []).reduce((sum, item) => sum + item.quantity, 0);
            return (
              <button
                key={ticket.id}
                className={`ticket-pill ${ticket.id === activeTicket.id ? 'active' : ''}`}
                onClick={() => setActiveTicketId(ticket.id)}
              >
                <span>{ticket.name}</span>
                <small>{formatCurrency(ticketTotal)} · {formatQuantity(itemCount)} pol.</small>
              </button>
            );
          })}
        </div>
        <div className="ticket-actions">
          <span className="muted">Celkem {formatCurrency(parkedTotal)}</span>
          <button className="ghost-button compact-button" onClick={renameActiveTicket}>Pojmenovat</button>
          <button className="ghost-button compact-button" onClick={() => closeEmptyTicket(activeTicket.id)} disabled={cart.length > 0 || tickets.length <= 1}>Zavřít prázdný</button>
          <button className="primary-button compact-button touch-add-ticket" onClick={createNewTicket}>+ Nový účet</button>
        </div>
      </section>

      <div className="cashier-grid compact-cashier-grid">
        <section className="card product-catalog-card">
          <div className="toolbar cashier-toolbar">
            <input
              className="search-input"
              placeholder="Hledat produkt, barkód nebo PLU"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="category-strip-wrap">
              <div className="category-tabs category-tabs-one-line">
                {orderedCategories.map((category, index) => {
                  const categoryMeta = getCategoryMeta(category, index);
                  return (
                    <button
                      key={category}
                      className={`tab-pill category-pill ${selectedCategory === category ? 'active' : ''}`}
                      style={categoryMeta.style}
                      onClick={() => setSelectedCategory(category)}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
              <button className="all-categories-button" type="button" onClick={() => setCategoryPickerOpen(true)}>
                Všechny kategorie
              </button>
            </div>
          </div>
          <div className="product-grid dense-product-grid">
            {filteredProducts.map((product) => {
              const weighted = isWeightUnit(product.unit);
              const visual = productVisuals[product.id] || getProductMeta(product, 0);
              return (
                <button
                  key={product.id}
                  className={`product-tile semantic-tile high-contrast-tile touch-product-tile ${(Number(product.stock) || 0) <= 0 ? 'warning-tile' : ''}`}
                  style={visual.style}
                  onPointerDown={(event) => startProductPress(product, event)}
                  onPointerMove={moveProductPress}
                  onPointerUp={() => finishProductPress(product)}
                  onPointerLeave={cancelProductPress}
                  onPointerCancel={cancelProductPress}
                  onContextMenu={(event) => openProductInfo(product, event)}
                >
                  <span className="tile-category">{product.category}</span>
                  <strong>{product.name}</strong>
                  <span className="tile-price">{formatCurrency(product.priceWithVat ?? product.price)}</span>
                  <span className="tile-bottom-row">
                    <small className="tile-unit-badge">{weighted ? 'kg' : formatUnitLabel(product.unit)}</small>
                    <small className="tile-info-hint">podržet ⓘ</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card cart-panel">
          <div className="section-title-row">
            <h2>{activeTicket.name}</h2>
            <button className="ghost-button compact-button" onClick={clearCart}>Vyčistit</button>
          </div>
          <div className="stack compact cart-items">
            {cart.length === 0 ? <p className="muted">Košík je prázdný.</p> : null}
            {cart.map((item) => {
              const weighted = isWeightUnit(item.unit);
              const lineDiscount = getLineDiscountAmount(item);
              const lineTotal = getLineTotal(item);
              return (
                <div key={item.productId} className="cart-row cart-item-row editable-cart-row" onClick={() => setEditingItemId(item.productId)} role="button" tabIndex="0">
                  <div>
                    <strong>{item.name}</strong>
                    <p className="muted">{formatCurrency(item.priceWithVat ?? item.price)} s DPH / {formatUnitLabel(item.unit)}</p>
                    {lineDiscount > 0 ? <p className="discount-line">Sleva {formatCurrency(lineDiscount)}</p> : null}
                  </div>
                  <div className="cart-quantity-block" onClick={(event) => event.stopPropagation()}>
                    <div className="quantity-controls">
                      <button type="button" onClick={() => adjustQuantity(item.productId, -1)}>-</button>
                      <input
                        className="cart-quantity-input"
                        type="number"
                        step={getQuantityStep(item.unit)}
                        min={weighted ? '0.001' : '1'}
                        value={item.quantity}
                        onChange={(event) => setQuantity(item.productId, event.target.value)}
                      />
                      <button type="button" onClick={() => adjustQuantity(item.productId, 1)}>+</button>
                    </div>
                    <div className="cart-line-total">{formatCurrency(lineTotal)}</div>
                    <button className="ghost-button mini-edit-button" type="button" onClick={() => setEditingItemId(item.productId)}>Upravit</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="discount-card">
            <div className="section-title-row">
              <strong>Sleva na celý nákup</strong>
              {ticketDiscountAmount > 0 ? <span className="badge warning-badge">-{formatCurrency(ticketDiscountAmount)}</span> : null}
            </div>
            <div className="discount-controls">
              <button type="button" className={`toggle-pill compact-pill ${activeTicket.discountMode !== 'percent' ? 'active' : ''}`} onClick={() => updateActiveTicketDiscount({ discountMode: 'amount' })}>Kč</button>
              <button type="button" className={`toggle-pill compact-pill ${activeTicket.discountMode === 'percent' ? 'active' : ''}`} onClick={() => updateActiveTicketDiscount({ discountMode: 'percent' })}>%</button>
              <input
                type="number"
                min="0"
                step={activeTicket.discountMode === 'percent' ? '1' : '0.5'}
                value={activeTicket.discountValue || ''}
                onChange={(event) => updateActiveTicketDiscount({ discountValue: parseNumber(event.target.value) })}
                placeholder="0"
              />
              {Number(activeTicket.discountValue) > 0 ? <button className="ghost-button small-btn" type="button" onClick={() => updateActiveTicketDiscount({ discountValue: 0 })}>Zrušit</button> : null}
            </div>
          </div>

          <div className="checkout-box stack compact">
            <div className="list-row"><span>Mezisoučet</span><strong>{formatCurrency(subtotalBeforeDiscounts)}</strong></div>
            {totalDiscount > 0 ? <div className="list-row"><span>Slevy celkem</span><strong className="warning-text">-{formatCurrency(totalDiscount)}</strong></div> : null}
            <div className="section-title-row checkout-total-row">
              <span>Celkem</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            <p className="muted no-margin">U vážených položek se při kliknutí otevře okno pro zadání množství v kg.</p>
            <button className="primary-button full-width touch-pay-button" disabled={cart.length === 0} onClick={() => setPaymentOpen(true)}>
              Zaplatit
            </button>
          </div>

          {lastPrintableSale ? (
            <div className="receipt-action-card">
              <div>
                <strong>Poslední doklad {lastPrintableSale.documentNumber}</strong>
                <p className="muted no-margin">Tisk je výchozí vypnutý. Účtenku vytiskneš jen ručně tímto tlačítkem.</p>
              </div>
              <button
                type="button"
                className="print-receipt-button"
                onClick={() => printSaleDocument(lastPrintableSale)}
              >
                <span className="print-receipt-icon">🖨️</span>
                <span>Vytisknout účtenku</span>
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {categoryPickerOpen ? (
        <div className="modal-backdrop modal-backdrop-scroll" onPointerDown={(event) => { if (event.target === event.currentTarget) setCategoryPickerOpen(false); }}>
          <div className="modal touch-modal category-picker-modal">
            <div className="modal-header">
              <div>
                <h3>Vybrat kategorii</h3>
                <p className="muted">Klepnutím na dlaždici se popup zavře a zobrazí se vybraná kategorie.</p>
              </div>
              <button className="ghost-button" onClick={() => setCategoryPickerOpen(false)}>✕</button>
            </div>
            <div className="category-picker-grid">
              {orderedCategories.map((category, index) => {
                const categoryMeta = getCategoryMeta(category, index);
                const count = category === 'Vše' ? orderedProducts.length : orderedProducts.filter((product) => product.category === category).length;
                return (
                  <button
                    key={category}
                    type="button"
                    className={`category-picker-tile ${selectedCategory === category ? 'active' : ''}`}
                    style={categoryMeta.style}
                    onClick={() => chooseCategory(category)}
                  >
                    <strong>{category}</strong>
                    <small>{count} produktů</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {productInfoProduct ? (
        <div className="modal-backdrop modal-backdrop-scroll" onPointerDown={(event) => { if (event.target === event.currentTarget) setProductInfoProduct(null); }}>
          <div className="modal touch-modal product-info-sheet">
            <div className="modal-header">
              <div>
                <h3>Detail produktu</h3>
                <p className="muted">Podržení dlaždice zobrazí sklad a prodejní informace.</p>
              </div>
              <button className="ghost-button" onClick={() => setProductInfoProduct(null)}>✕</button>
            </div>
            <div className="product-info-hero">
              <span className="tile-category">{productInfoProduct.category || 'Bez kategorie'}</span>
              <h2>{productInfoProduct.name}</h2>
              <strong>{formatCurrency(productInfoProduct.priceWithVat ?? productInfoProduct.price)} s DPH / {formatUnitLabel(productInfoProduct.unit)}</strong>
            </div>
            <div className="product-info-grid">
              <div className="info-metric stock-metric">
                <span>Sklad</span>
                <strong>{formatQuantity(productInfoProduct.stock)} {formatUnitLabel(productInfoProduct.unit)}</strong>
              </div>
              <div className="info-metric">
                <span>Na otevřených účtech</span>
                <strong>{formatQuantity(getQuantityOnOpenTickets(productInfoProduct.id))} {formatUnitLabel(productInfoProduct.unit)}</strong>
              </div>
              <div className="info-metric">
                <span>EAN</span>
                <strong>{productInfoProduct.barcode || '—'}</strong>
              </div>
              <div className="info-metric">
                <span>PLU</span>
                <strong>{productInfoProduct.plu || '—'}</strong>
              </div>
              <div className="info-metric">
                <span>Cena bez DPH</span>
                <strong>{formatCurrency(productInfoProduct.priceWithoutVat || netFromGross(productInfoProduct.priceWithVat ?? productInfoProduct.price, productInfoProduct.vatRate))}</strong>
              </div>
              <div className="info-metric">
                <span>DPH</span>
                <strong>{Number(productInfoProduct.vatRate) || 0} % · {formatCurrency(vatFromGross(productInfoProduct.priceWithVat ?? productInfoProduct.price, productInfoProduct.vatRate))}</strong>
              </div>
              <div className="info-metric">
                <span>Typ prodeje</span>
                <strong>{isWeightUnit(productInfoProduct.unit) ? 'Na váhu' : 'Kusový'}</strong>
              </div>
            </div>
            <div className="form-actions product-info-actions">
              <button className="ghost-button" onClick={() => setProductInfoProduct(null)}>Zavřít</button>
              <button className="primary-button touch-confirm-button" onClick={addProductFromInfo}>Přidat do účtu</button>
            </div>
          </div>
        </div>
      ) : null}

      {weightProduct ? (
        <div className="modal-backdrop modal-backdrop-scroll">
          <div className="modal touch-modal quantity-modal">
            <div className="modal-header">
              <div>
                <h3>Zadat množství</h3>
                <p className="muted">{weightProduct.name} · prodej na kg</p>
              </div>
              <button className="ghost-button" onClick={() => setWeightProduct(null)}>✕</button>
            </div>
            <div className="stack">
              <label>Množství v kg
                <input
                  className="touch-number-input"
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={weightQuantity}
                  onChange={(event) => setWeightQuantity(event.target.value)}
                  autoFocus
                  placeholder="např. 0,250"
                />
              </label>
              <div className="quick-qty-grid">
                {['0.05', '0.10', '0.25', '0.50', '1.00'].map((value) => (
                  <button key={value} type="button" className="ghost-button" onClick={() => setWeightQuantity(value)}>{value.replace('.', ',')} kg</button>
                ))}
              </div>
              <div className="summary-box summary-box-inline">
                <span>Cena</span>
                <strong>{formatCurrency((Number(weightProduct.priceWithVat ?? weightProduct.price) || 0) * sanitizePositiveQuantity(weightQuantity, weightProduct.unit))}</strong>
              </div>
              <div className="form-actions">
                <button className="ghost-button" onClick={() => setWeightProduct(null)}>Zrušit</button>
                <button className="primary-button touch-confirm-button" onClick={confirmWeightProduct}>Přidat do účtu</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editingItem ? (
        <div className="modal-backdrop modal-backdrop-scroll">
          <div className="modal touch-modal item-edit-modal">
            <div className="modal-header">
              <div>
                <h3>Upravit položku</h3>
                <p className="muted">{editingItem.name}</p>
              </div>
              <button className="ghost-button" onClick={() => setEditingItemId('')}>✕</button>
            </div>
            <div className="stack">
              <div className="form-grid">
                <label>Množství ({formatUnitLabel(editingItem.unit)})
                  <input type="number" min={isWeightUnit(editingItem.unit) ? '0.001' : '1'} step={getQuantityStep(editingItem.unit)} value={editingItem.quantity} onChange={(event) => updateCartItem(editingItem.productId, { quantity: normalizeCartQuantity(event.target.value, editingItem.unit) })} />
                </label>
                <label>Cena za jednotku s DPH
                  <input type="number" min="0" step="0.01" value={editingItem.priceWithVat ?? editingItem.price} onChange={(event) => { const value = parseNumber(event.target.value); updateCartItem(editingItem.productId, { price: value, priceWithVat: value, priceWithoutVat: netFromGross(value, editingItem.vatRate) }); }} />
                </label>
              </div>
              <div className="inner-card stack compact">
                <div className="section-title-row">
                  <strong>Sleva na položku</strong>
                  {getLineDiscountAmount(editingItem) > 0 ? <span className="badge warning-badge">-{formatCurrency(getLineDiscountAmount(editingItem))}</span> : null}
                </div>
                <div className="discount-controls">
                  <button type="button" className={`toggle-pill compact-pill ${editingItem.discountType !== 'percent' ? 'active' : ''}`} onClick={() => updateCartItem(editingItem.productId, { discountType: 'amount' })}>Kč</button>
                  <button type="button" className={`toggle-pill compact-pill ${editingItem.discountType === 'percent' ? 'active' : ''}`} onClick={() => updateCartItem(editingItem.productId, { discountType: 'percent' })}>%</button>
                  <input type="number" min="0" step={editingItem.discountType === 'percent' ? '1' : '0.5'} value={editingItem.discountValue || ''} onChange={(event) => updateCartItem(editingItem.productId, { discountValue: parseNumber(event.target.value) })} placeholder="0" />
                  {Number(editingItem.discountValue) > 0 ? <button className="ghost-button small-btn" type="button" onClick={() => updateCartItem(editingItem.productId, { discountValue: 0 })}>Zrušit</button> : null}
                </div>
              </div>
              <div className="summary-box">
                <div className="list-row"><span>Původní řádek</span><strong>{formatCurrency(getLineGross(editingItem))}</strong></div>
                <div className="list-row"><span>Po slevě</span><strong>{formatCurrency(getLineTotal(editingItem))}</strong></div>
              </div>
              <div className="form-actions">
                <button className="ghost-button danger-outline" onClick={() => removeCartItem(editingItem.productId)}>Odebrat položku</button>
                <button className="primary-button touch-confirm-button" onClick={() => setEditingItemId('')}>Hotovo</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <PaymentDialog open={paymentOpen} onClose={() => setPaymentOpen(false)} total={total} documentNumberPreview={buildDocumentNumber(nextDocumentSequence || 1, new Date().toISOString())} onConfirm={handleCompleteSale} />
    </div>
  );
}

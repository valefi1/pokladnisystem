import { useMemo, useState } from 'react';
import { PaymentDialog } from '../components/PaymentDialog';
import { formatCurrency, formatQuantity } from '../lib/format';
import { formatUnitLabel, getDefaultSaleQuantity, getQuantityStep, isWeightUnit, normalizeCartQuantity } from '../lib/productUnits';
import { printSaleDocument } from '../lib/receiptPrint';
import { CashCountForm, getCashBreakdownTotal, normalizeCashBreakdown } from '../components/CashCountForm';
import { getCategoryMeta, getProductMeta, sortCategories, sortProductsForCatalog } from '../lib/catalogPresentation';

function buildDocumentNumber(sequence, createdAt) {
  const date = new Date(createdAt);
  const prefix = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

function createCartItem(product) {
  return {
    productId: product.id,
    name: product.name,
    price: Number(product.price) || 0,
    unit: product.unit,
    category: product.category || '',
    vatRate: Number(product.vatRate) || 12,
    quantity: getDefaultSaleQuantity(product.unit),
  };
}

export function CashierPage({ products, categories, nextDocumentSequence, activeCashSession, cashSessions = [], onOpenCashRegister, onCompleteSale }) {
  const [selectedCategory, setSelectedCategory] = useState('Vše');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [openingBreakdown, setOpeningBreakdown] = useState({});
  const [openedBy, setOpenedBy] = useState('');
  const [openingNote, setOpeningNote] = useState('');

  const stockByProduct = useMemo(() => Object.fromEntries(products.map((product) => [product.id, Number(product.stock) || 0])), [products]);
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

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const addToCart = (product) => {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      const step = getQuantityStep(product.unit);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: normalizeCartQuantity(item.quantity + step, item.unit) }
            : item
        );
      }
      return [...current, createCartItem(product)];
    });
  };

  const setQuantity = (productId, rawValue) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) return item;
          return { ...item, quantity: normalizeCartQuantity(rawValue, item.unit) };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const adjustQuantity = (productId, direction) => {
    setCart((current) =>
      current
        .map((item) => {
          if (item.productId !== productId) return item;
          const step = getQuantityStep(item.unit);
          return { ...item, quantity: normalizeCartQuantity(item.quantity + direction * step, item.unit) };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const clearCart = () => setCart([]);

  const handleCompleteSale = (payment) => {
    const createdAt = new Date().toISOString();
    const receiptPayload = {
      createdAt,
      documentNumber: buildDocumentNumber(nextDocumentSequence || 1, createdAt),
      items: cart,
      subtotal: total,
      total: total + (Number(payment.tipAmount) || 0),
      tipAmount: payment.tipAmount || 0,
      paymentMethod: payment.paymentMethod,
      cashReceived: payment.paymentMethod === 'cash' ? Number(payment.cashReceived) || 0 : 0,
      change: payment.paymentMethod === 'cash' ? Math.max(0, (Number(payment.cashReceived) || 0) - (total + (Number(payment.tipAmount) || 0))) : 0,
      invoiceCustomer: payment.invoiceCustomer,
      invoiceDueDate: payment.invoiceDueDate,
      voucherLabel: payment.voucherLabel,
      note: payment.note,
    };

    onCompleteSale({ items: cart, ...payment });
    if (payment.printReceipt && !payment.unpaid) {
      printSaleDocument(receiptPayload);
    }
    setCart([]);
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
                <strong style={{color: openingDifference === 0 ? 'var(--color-text)' : openingDifference < 0 ? 'var(--color-text-danger)' : 'var(--color-text-warning)'}}>
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
      <section className="page-header">
        <div>
          <h1>Pokladna</h1>
          <p className="muted">Produkty jsou nově seskupené po podobných řadách a barevně rozlišené, aby šly rychleji najít. V rámci jedné řady držím podobné odstíny, ale ne úplně stejné dlaždice vedle sebe.</p>
          <p className="muted">Pokladna otevřena od {new Date(activeCashSession.openedAt).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'})} · počáteční hotovost {formatCurrency(activeCashSession.openingCash || 0)}</p>
        </div>
      </section>

      <div className="cashier-grid">
        <section className="card">
          <div className="toolbar">
            <input
              className="search-input"
              placeholder="Hledat produkt, barkód nebo PLU"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="category-tabs">
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
          </div>
          <div className="product-grid">
            {filteredProducts.map((product) => {
              const weighted = isWeightUnit(product.unit);
              const visual = productVisuals[product.id] || getProductMeta(product, 0);
              return (
                <button
                  key={product.id}
                  className={`product-tile semantic-tile ${(Number(product.stock) || 0) <= 0 ? 'warning-tile' : ''}`}
                  style={visual.style}
                  onClick={() => addToCart(product)}
                >
                  <span className="tile-category">{product.category}</span>
                  <strong>{product.name}</strong>
                  <span className="tile-family">{visual.family}</span>
                  <span>{formatCurrency(product.price)}</span>
                  <small>{weighted ? 'na váhu · po 0,001 kg' : 'kusový prodej'}</small>
                  <small>Sklad {formatQuantity(product.stock)} {formatUnitLabel(product.unit)}</small>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card cart-panel">
          <div className="section-title-row">
            <h2>Účet</h2>
            <button className="ghost-button" onClick={clearCart}>Vyčistit</button>
          </div>
          <div className="stack compact cart-items">
            {cart.length === 0 ? <p className="muted">Košík je prázdný.</p> : null}
            {cart.map((item) => {
              const weighted = isWeightUnit(item.unit);
              const currentStock = stockByProduct[item.productId] ?? 0;
              const projectedStock = currentStock - item.quantity;
              return (
                <div key={item.productId} className="cart-row cart-item-row">
                  <div>
                    <strong>{item.name}</strong>
                    <p className="muted">{formatCurrency(item.price)} / {formatUnitLabel(item.unit)}</p>
                    <p className="muted">Po prodeji: {formatQuantity(projectedStock)} {formatUnitLabel(item.unit)}</p>
                  </div>
                  <div className="cart-quantity-block">
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
                    <div className="cart-line-total">{formatCurrency(item.price * item.quantity)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="checkout-box stack compact">
            <div className="section-title-row">
              <span>Celkem</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            <p className="muted no-margin">U vážených položek můžeš prodávat po 0,001 kg. Záporný sklad prodej neblokuje.</p>
            <button className="primary-button full-width" disabled={cart.length === 0} onClick={() => setPaymentOpen(true)}>
              Zaplatit
            </button>
          </div>
        </aside>
      </div>

      <PaymentDialog open={paymentOpen} onClose={() => setPaymentOpen(false)} total={total} documentNumberPreview={buildDocumentNumber(nextDocumentSequence || 1, new Date().toISOString())} onConfirm={handleCompleteSale} />
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { ProductFormModal } from '../components/ProductFormModal';
import { formatCurrency, formatDaysToZero, formatQuantity } from '../lib/format';
import { parseStockMovementHistoryCsv, parseStockSnapshotCsv } from '../lib/csvImport';
import { parseDotykackaCsv, readFileAsText } from '../lib/parseDotykackaCsv';
import { PRODUCT_COLOR_PALETTE, getProductMeta, sortProductsForCatalog, sortProductsWithinCategory } from '../lib/catalogPresentation';
import { netFromGross } from '../lib/vat';

export function ProductsPage({ products, categories, analyticsMap, onAddProduct, onUpdateProduct, onUpdateProductPresentation, onImportStockSnapshot, onImportMovementHistory, onImportDotykackaCsv }) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Vše');
  const [orderCategory, setOrderCategory] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [importMessage, setImportMessage] = useState('');
  const stockInputRef = useRef(null);
  const movementInputRef = useRef(null);
  const dotykackaInputRef = useRef(null);
  const [importResult, setImportResult] = useState(null); // {updated, added, fileName}
  const [dragProductId, setDragProductId] = useState('');

  const categoryOptions = useMemo(() => categories.filter((category) => category && category !== 'Vše'), [categories]);

  const activeOrderCategory = orderCategory || categoryOptions[0] || '';

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return sortProductsForCatalog(products).filter((product) => {
      const matchesSearch = `${product.name} ${product.category} ${product.barcode} ${product.plu}`.toLowerCase().includes(query);
      const matchesCategory = selectedCategory === 'Vše' || product.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, selectedCategory]);

  const orderedCategoryProducts = useMemo(() => {
    if (!activeOrderCategory) return [];
    return sortProductsWithinCategory(products.filter((product) => product.category === activeOrderCategory && !product.hidden));
  }, [activeOrderCategory, products]);

  const productVisuals = useMemo(() => {
    const groupCounts = new Map();
    return Object.fromEntries(
      filtered.map((product) => {
        const meta = getProductMeta(product, groupCounts.get(`${product.category}::${product.name}`) || 0);
        const familyKey = `${product.category}::${meta.family}`;
        const nextIndex = groupCounts.get(familyKey) || 0;
        groupCounts.set(familyKey, nextIndex + 1);
        return [product.id, getProductMeta(product, nextIndex)];
      })
    );
  }, [filtered]);

  const openCreate = () => {
    setSelectedProduct(null);
    setModalOpen(true);
  };

  const openEdit = (product) => {
    setSelectedProduct(product);
    setModalOpen(true);
  };

  const handleSave = (payload) => {
    if (payload.id) {
      onUpdateProduct(payload);
      return;
    }
    onAddProduct(payload);
  };

  const handleStockImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImportMessage('Načítám import a zapisuji ho do Supabase…');
      const text = await file.text();
      const importedProducts = parseStockSnapshotCsv(text);
      const result = await onImportStockSnapshot(importedProducts, file.name);
      const examples = result?.examples?.length ? `\nUkázky: ${result.examples.join(' | ')}` : '';
      setImportMessage(`Import stavu skladu dokončen: ${importedProducts.length} řádků CSV. Zapsáno/ověřeno v Supabase: ${result?.updated ?? importedProducts.length}/${result?.verified ?? importedProducts.length}. Nové: ${result?.inserted ?? 0}, nalezené: ${result?.matched ?? 0}, opravené duplicity: ${result?.duplicatesUpdated ?? 0}.${examples}`);
    } catch (error) {
      setImportMessage(`Chyba importu: ${error.message || 'nepodařilo se zapsat import do Supabase'}`);
    } finally {
      event.target.value = '';
    }
  };

  const handleMovementImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImportMessage('Načítám historii pohybů a zapisuji ji do Supabase…');
      const text = await file.text();
      const rows = parseStockMovementHistoryCsv(text);
      await onImportMovementHistory(rows, file.name);
      setImportMessage(`Naimportována historie skladových pohybů: ${rows.length} řádků ze souboru ${file.name}. Změny jsou zapsané do Supabase.`);
    } catch (error) {
      setImportMessage(`Chyba importu historie: ${error.message || 'nepodařilo se zapsat import do Supabase'}`);
    } finally {
      event.target.value = '';
    }
  };

  const handleDotykackaCsvImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const products = parseDotykackaCsv(text);
      await onImportDotykackaCsv(products, file.name);
      setImportResult({ fileName: file.name, total: products.length });
    } catch (err) {
      setImportResult({ fileName: file.name, error: err.message });
    }
    event.target.value = '';
  };

  const saveManualOrder = (nextOrderedProducts) => {
    nextOrderedProducts.forEach((product, index) => {
      const nextOrder = index + 1;
      if (Number(product.displayOrder) !== nextOrder) {
        onUpdateProductPresentation?.({ id: product.id, displayOrder: nextOrder });
      }
    });
  };

  const moveProductInCategory = (productId, direction) => {
    const currentIndex = orderedCategoryProducts.findIndex((product) => product.id === productId);
    if (currentIndex < 0) return;
    const targetIndex = direction === 'first' ? 0 : currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= orderedCategoryProducts.length || targetIndex === currentIndex) return;
    const next = [...orderedCategoryProducts];
    const [item] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, item);
    saveManualOrder(next);
  };

  const setProductTileColor = (productId, tileColor) => {
    onUpdateProductPresentation?.({ id: productId, tileColor });
  };

  const moveProductToPosition = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const sourceIndex = orderedCategoryProducts.findIndex((product) => product.id === sourceId);
    const targetIndex = orderedCategoryProducts.findIndex((product) => product.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...orderedCategoryProducts];
    const [item] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, item);
    saveManualOrder(next);
  };

  const startTileDrag = (productId, event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    setDragProductId(productId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const finishTileDrag = (targetProductId) => {
    if (dragProductId) moveProductToPosition(dragProductId, targetProductId);
    setDragProductId('');
  };

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>Produkty</h1>
          <p className="muted">Katalog je nově seřazený po podobných řadách. Ochucené kefíry, jogurty nebo varianty stejné řady držím vedle sebe, aby se v tom rychleji hledalo.</p>
        </div>
        <div className="inline-actions">
          <input ref={stockInputRef} type="file" accept=".csv" className="hidden-file-input" onChange={handleStockImport} />
          <input ref={movementInputRef} type="file" accept=".csv" className="hidden-file-input" onChange={handleMovementImport} />
          <button className="ghost-button" onClick={() => stockInputRef.current?.click()}>Import stavu skladu</button>
          <button className="ghost-button" onClick={() => movementInputRef.current?.click()}>Import skladových pohybů</button>
          <input ref={dotykackaInputRef} type="file" accept=".csv" className="hidden-file-input" onChange={handleDotykackaCsvImport} />
          <button className="ghost-button accent-outline" onClick={() => dotykackaInputRef.current?.click()}>
            ↑ Import z Dotykačky (CSV)
          </button>
          <button className="primary-button" onClick={openCreate}>Nový produkt</button>
        </div>
      </section>

      {importResult && (
        <div className={`card ${importResult.error ? 'danger-card' : 'info-card'}`} style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            {importResult.error
              ? <><strong>Chyba importu:</strong> {importResult.error}</>
              : <><strong>Import z Dotykačky dokončen</strong> · {importResult.fileName}<br/>
                  <span className="muted">Celkem zpracováno: <strong>{importResult.total} produktů</strong> (aktualizovány ceny + DPH, přidány nové)</span></>
            }
          </div>
          <button className="ghost-button small-btn" onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {importMessage ? (
        <div className={`card ${importMessage.startsWith('Chyba') ? 'danger-card' : 'info-card'}`} style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'1rem'}}>
          <div style={{whiteSpace:'pre-wrap'}}>
            <strong>{importMessage.startsWith('Chyba') ? 'Import stavu skladu selhal' : 'Import stavu skladu'}</strong><br/>
            <span>{importMessage}</span>
          </div>
          <button className="ghost-button small-btn" onClick={() => setImportMessage('')}>✕</button>
        </div>
      ) : null}

      <section className="card">
        <div className="toolbar space-between product-filter-toolbar">
          <input className="search-input" placeholder="Hledat název, barkód nebo PLU" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="compact-select-label">Kategorie
            <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
              <option value="Vše">Všechny kategorie</option>
              {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <span className="muted">{filtered.length} položek</span>
        </div>

        <div className="product-order-panel">
          <div className="section-title-row">
            <div>
              <strong>Pořadí dlaždic v pokladně</strong>
              <p className="muted no-margin">Vyber kategorii a posuň produkty. Pořadí se uloží i do Supabase a projeví se v pokladně.</p>
            </div>
            <label className="compact-select-label">Řadit kategorii
              <select value={activeOrderCategory} onChange={(event) => setOrderCategory(event.target.value)}>
                {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
          </div>
          <div className="product-order-grid">
            {orderedCategoryProducts.map((product, index) => {
              const visual = getProductMeta(product, index);
              return (
                <div
                  key={product.id}
                  className={`product-order-tile draggable-order-tile ${dragProductId === product.id ? 'dragging' : ''}`}
                  style={visual.style}
                  onPointerDown={(event) => startTileDrag(product.id, event)}
                  onPointerUp={() => finishTileDrag(product.id)}
                  onPointerCancel={() => setDragProductId('')}
                >
                  <div>
                    <span className="order-number">#{index + 1}</span>
                    <strong>{product.name}</strong>
                    <small>{formatCurrency(product.priceWithVat ?? product.price)}</small>
                    <small className="drag-hint">podrž a přetáhni na nové místo</small>
                    <div className="tile-color-palette" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className={`color-swatch ${!product.tileColor ? 'active' : ''}`}
                        title="Automatická barva"
                        onClick={() => setProductTileColor(product.id, '')}
                      >A</button>
                      {PRODUCT_COLOR_PALETTE.map((color) => (
                        <button
                          key={color.key}
                          type="button"
                          className={`color-swatch ${product.tileColor === color.key ? 'active' : ''}`}
                          style={{ '--tile-h': color.hue }}
                          title={color.label}
                          onClick={() => setProductTileColor(product.id, color.key)}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="order-buttons" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
                    <button type="button" className="ghost-button small-btn" disabled={index === 0} onClick={() => moveProductInCategory(product.id, 'first')}>Na začátek</button>
                    <button type="button" className="ghost-button small-btn" disabled={index === 0} onClick={() => moveProductInCategory(product.id, -1)}>↑</button>
                    <button type="button" className="ghost-button small-btn" disabled={index === orderedCategoryProducts.length - 1} onClick={() => moveProductInCategory(product.id, 1)}>↓</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Název</th>
                <th>Kategorie</th>
                <th>Řada</th>
                <th>Cena s DPH</th>
                <th>Cena bez DPH</th>
                <th>DPH</th>
                <th>Nákupka</th>
                <th>Sklad</th>
                <th>Days to zero</th>
                <th>Stav</th>
                <th>Pořadí</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => {
                const analytics = analyticsMap[product.id];
                const visual = productVisuals[product.id] || getProductMeta(product, 0);
                return (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.name}</strong>
                      <div className="table-subline">{product.barcode || product.plu || 'bez barkódu/PLU'}</div>
                    </td>
                    <td><span className="category-chip" style={visual.style}>{product.category}</span></td>
                    <td><span className="badge family-badge" style={visual.style}>{visual.family}</span></td>
                    <td>{formatCurrency(product.priceWithVat ?? product.price)}</td>
                    <td>{formatCurrency(product.priceWithoutVat || netFromGross(product.priceWithVat ?? product.price, product.vatRate))}</td>
                    <td>{Number(product.vatRate) || 0} %</td>
                    <td>{formatCurrency(product.costPrice || 0)}</td>
                    <td>{formatQuantity(product.stock)} {product.unit}</td>
                    <td>{analytics?.daysToZero == null ? '—' : formatDaysToZero(analytics.daysToZero)}</td>
                    <td>
                      {product.hidden ? <span className="badge">Skrytý</span> : <span className={`badge ${analytics?.statusTone || 'accent-badge'}`}>{analytics?.statusLabel || 'Aktivní'}</span>}
                    </td>
                    <td>{Number.isFinite(Number(product.displayOrder)) ? `#${Number(product.displayOrder)}` : 'auto'}</td>
                    <td><button className="ghost-button" onClick={() => openEdit(product)}>Upravit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        product={selectedProduct}
        existingCategories={categories.filter((category) => category !== 'Vše')}
      />
    </div>
  );
}

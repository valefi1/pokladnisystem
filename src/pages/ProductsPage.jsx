import { useMemo, useRef, useState } from 'react';
import { ProductFormModal } from '../components/ProductFormModal';
import { formatCurrency, formatDaysToZero, formatQuantity } from '../lib/format';
import { parseStockMovementHistoryCsv, parseStockSnapshotCsv } from '../lib/csvImport';
import { parseDotykackaCsv, readFileAsText } from '../lib/parseDotykackaCsv';
import { getProductMeta, sortProductsForCatalog } from '../lib/catalogPresentation';

export function ProductsPage({ products, categories, analyticsMap, onAddProduct, onUpdateProduct, onImportStockSnapshot, onImportMovementHistory, onImportDotykackaCsv }) {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [importMessage, setImportMessage] = useState('');
  const stockInputRef = useRef(null);
  const movementInputRef = useRef(null);
  const dotykackaInputRef = useRef(null);
  const [importResult, setImportResult] = useState(null); // {updated, added, fileName}

  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return sortProductsForCatalog(products).filter((product) => `${product.name} ${product.category} ${product.barcode} ${product.plu}`.toLowerCase().includes(query));
  }, [products, search]);

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

    const text = await file.text();
    const importedProducts = parseStockSnapshotCsv(text);
    onImportStockSnapshot(importedProducts, file.name);
    setImportMessage(`Naimportován snapshot skladu: ${importedProducts.length} položek ze souboru ${file.name}.`);
    event.target.value = '';
  };

  const handleMovementImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const rows = parseStockMovementHistoryCsv(text);
    onImportMovementHistory(rows, file.name);
    setImportMessage(`Naimportována historie skladových pohybů: ${rows.length} řádků ze souboru ${file.name}.`);
    event.target.value = '';
  };

  const handleDotykackaCsvImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const products = parseDotykackaCsv(text);
      onImportDotykackaCsv(products, file.name);
      setImportResult({ fileName: file.name, total: products.length });
    } catch (err) {
      setImportResult({ fileName: file.name, error: err.message });
    }
    event.target.value = '';
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

      <section className="card">
        <div className="toolbar space-between">
          <input className="search-input" placeholder="Hledat název, barkód nebo PLU" value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="muted">{filtered.length} položek</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Název</th>
                <th>Kategorie</th>
                <th>Řada</th>
                <th>Cena</th>
                <th>Nákupka</th>
                <th>Sklad</th>
                <th>Days to zero</th>
                <th>Stav</th>
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
                    <td>{formatCurrency(product.price)}</td>
                    <td>{formatCurrency(product.costPrice || 0)}</td>
                    <td>{formatQuantity(product.stock)} {product.unit}</td>
                    <td>{analytics?.daysToZero == null ? '—' : formatDaysToZero(analytics.daysToZero)}</td>
                    <td>
                      {product.hidden ? <span className="badge">Skrytý</span> : <span className={`badge ${analytics?.statusTone || 'accent-badge'}`}>{analytics?.statusLabel || 'Aktivní'}</span>}
                    </td>
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

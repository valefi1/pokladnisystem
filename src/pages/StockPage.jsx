import { useMemo, useState } from 'react';
import { StockMovementModal } from '../components/StockMovementModal';
import { formatDateTime, formatDaysToZero, formatQuantity } from '../lib/format';

export function StockPage({ products, movements, analyticsMap, onApplyMovement }) {
  const [search, setSearch] = useState('');
  const [onlyAudit, setOnlyAudit] = useState(false);
  const [movementConfig, setMovementConfig] = useState({ open: false, product: null, movementType: null });

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesSearch = `${product.name} ${product.category} ${product.barcode} ${product.plu}`.toLowerCase().includes(search.toLowerCase());
      const analytics = analyticsMap[product.id];
      const matchesAudit = !onlyAudit || analytics?.statusBucket === 'audit';
      return matchesSearch && matchesAudit;
    });
  }, [analyticsMap, onlyAudit, products, search]);

  const openMovement = (product, movementType) => {
    setMovementConfig({ open: true, product, movementType });
  };

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>Sklad</h1>
          <p className="muted">Příjem, odpis, inventura a rychlá kontrola položek k naskladnění.</p>
        </div>
      </section>

      <section className="card">
        <div className="toolbar space-between">
          <input className="search-input" placeholder="Hledat ve skladu" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="checkbox-row">
            <input type="checkbox" checked={onlyAudit} onChange={(e) => setOnlyAudit(e.target.checked)} />
            Jen k naskladnění
          </label>
        </div>
        <div className="stock-list">
          {filteredProducts.map((product) => {
            const analytics = analyticsMap[product.id];
            return (
              <article key={product.id} className="stock-card">
                <div>
                  <div className="section-title-row">
                    <strong>{product.name}</strong>
                    <div className="inline-actions compact-actions">
                      {analytics?.statusLabel ? <span className={`badge ${analytics.statusTone}`}>{analytics.statusLabel}</span> : null}
                      {analytics?.daysToZero != null ? <span className="badge">{formatDaysToZero(analytics.daysToZero)}</span> : null}
                    </div>
                  </div>
                  <p className="muted">{product.category} · {product.barcode || product.plu || 'bez barkódu/PLU'}</p>
                  <p>Skladem <strong>{formatQuantity(product.stock)}</strong> {product.unit} · odtok <strong>{analytics?.weightedDailyOutflow ? formatQuantity(analytics.weightedDailyOutflow) : '—'}</strong> / den</p>
                </div>
                <div className="inline-actions">
                  <button className="ghost-button" onClick={() => openMovement(product, 'receipt')}>Příjem</button>
                  <button className="ghost-button" onClick={() => openMovement(product, 'writeoff')}>Odpis</button>
                  <button className="primary-button" onClick={() => openMovement(product, 'inventory')}>Inventura</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="section-title-row">
          <h2>Ruční historie pohybů</h2>
          <span className="badge">{movements.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Produkt</th>
                <th>Typ</th>
                <th>Před</th>
                <th>Po</th>
                <th>Poznámka</th>
              </tr>
            </thead>
            <tbody>
              {movements.slice(0, 20).map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDateTime(movement.createdAt)}</td>
                  <td>{movement.productName}</td>
                  <td>{movement.type}</td>
                  <td>{formatQuantity(movement.beforeStock)}</td>
                  <td>{formatQuantity(movement.afterStock)}</td>
                  <td>{movement.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <StockMovementModal
        open={movementConfig.open}
        onClose={() => setMovementConfig({ open: false, product: null, movementType: null })}
        onSubmit={onApplyMovement}
        product={movementConfig.product}
        movementType={movementConfig.movementType}
      />
    </div>
  );
}

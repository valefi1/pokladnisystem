import { useMemo, useState } from 'react';
import { ColumnChart, ProgressList, SegmentedStatus, chartFormatters } from '../components/SimpleCharts';
import { formatDate, formatDaysToZero, formatQuantity } from '../lib/format';

export function AnalyticsPage({ state, derived }) {
  const { inventory } = derived;
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filteredRows = useMemo(() => {
    return inventory.stockoutForecasts.filter((item) => {
      const matchesSearch = `${item.productName} ${item.category}`.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || item.statusBucket === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [inventory.stockoutForecasts, search, statusFilter]);

  const dueBucketItems = [
    { label: 'K naskladnění', value: inventory.auditQueue.length },
    { label: 'Do 3 dnů', value: inventory.dueIn3.length },
    { label: 'Do 7 dnů', value: inventory.dueIn7.length },
    { label: 'Do 14 dnů', value: inventory.dueIn14.length },
    { label: 'Bez dat', value: inventory.noHistoryCount },
  ];

  const topVelocityItems = inventory.topVelocity
    .slice(0, 8)
    .map((item) => ({ label: item.productName, value: item.weightedDailyOutflow, note: item.category }));

  const categorySoonItems = inventory.categorySummary
    .slice(0, 8)
    .map((row) => ({ label: row.category, value: row.soonCount, note: `${row.auditCount} k naskladnění` }));

  const segments = [
    { label: 'Audit', value: inventory.auditQueue.length, className: 'segment-danger' },
    { label: '3 dny', value: inventory.dueIn3.length, className: 'segment-warning' },
    { label: '7 dnů', value: inventory.dueIn7.length, className: 'segment-accent' },
    { label: '14 dnů', value: inventory.dueIn14.length, className: 'segment-info' },
    { label: 'Bez dat', value: inventory.noHistoryCount, className: 'segment-neutral' },
  ];

  return (
    <div className="page-stack">
      <section className="page-header panel-header">
        <div>
          <p className="eyebrow">Analytika · days to zero</p>
          <h1>Analytika zásob</h1>
          <p className="muted">UI přiblížené dotykačkovému admin stylu: světlejší plochy, kontrastní tabulky a grafické shrnutí priorit.</p>
        </div>
      </section>

      <section className="stats-grid analytics-stats-grid">
        <div className="card stat-card accent-card">
          <p className="eyebrow">Hodnota skladu</p>
          <strong className="stat-value">{chartFormatters.currency(inventory.totalStockValue)}</strong>
          <p className="muted">Součet nákladové hodnoty zásob.</p>
        </div>
        <div className="card stat-card">
          <p className="eyebrow">K naskladnění</p>
          <strong className="stat-value">{inventory.auditQueue.length}</strong>
          <p className="muted">Nula nebo mínus na skladu.</p>
        </div>
        <div className="card stat-card">
          <p className="eyebrow">Do 14 dnů</p>
          <strong className="stat-value">{inventory.dueIn3.length + inventory.dueIn7.length + inventory.dueIn14.length}</strong>
          <p className="muted">Riziko vyprodání podle odtoku.</p>
        </div>
        <div className="card stat-card">
          <p className="eyebrow">Bez dat</p>
          <strong className="stat-value">{inventory.noHistoryCount}</strong>
          <p className="muted">Zatím bez použitelné historie odtoku.</p>
        </div>
      </section>

      <section className="dashboard-grid-hero">
        <ColumnChart title="Položky podle priority" items={dueBucketItems} formatValue={chartFormatters.quantity} colorClass="bar-green" />
        <SegmentedStatus title="Struktura rizika" segments={segments} />
      </section>

      <section className="dashboard-grid-hero">
        <ProgressList title="Nejvyšší odtok" items={topVelocityItems} formatValue={(value) => `${formatQuantity(value)} / den`} colorClass="bar-blue" />
        <ProgressList title="Kategorie s největším tlakem" items={categorySoonItems} formatValue={(value) => `${value} položek`} colorClass="bar-orange" />
      </section>

      <section className="split-grid analytics-grid">
        <div className="card soft-card">
          <div className="section-title-row">
            <h2>Fronta days to zero</h2>
            <span className="badge">{filteredRows.length}</span>
          </div>
          <div className="toolbar space-between toolbar-gap">
            <input className="search-input" placeholder="Hledat produkt nebo kategorii" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="category-tabs">
              {[
                ['all', 'Vše'],
                ['audit', 'K naskladnění'],
                ['d3', 'Do 3 dnů'],
                ['d7', 'Do 7 dnů'],
                ['d14', 'Do 14 dnů'],
                ['unknown', 'Bez dat'],
              ].map(([value, label]) => (
                <button key={value} className={`tab-pill ${statusFilter === value ? 'active' : ''}`} onClick={() => setStatusFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="table-wrap table-shell">
            <table>
              <thead>
                <tr>
                  <th>Produkt</th>
                  <th>Sklad</th>
                  <th>Průměr 28 dní</th>
                  <th>Průměr 56 dní</th>
                  <th>Vážený odtok</th>
                  <th>Days to zero</th>
                  <th>Stav</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((item) => (
                  <tr key={item.productId}>
                    <td>
                      <strong>{item.productName}</strong>
                      <div className="table-subline">{item.category}</div>
                    </td>
                    <td>{formatQuantity(item.currentStock)}</td>
                    <td>{item.avgDaily28 > 0 ? formatQuantity(item.avgDaily28) : '—'}</td>
                    <td>{item.avgDaily56 > 0 ? formatQuantity(item.avgDaily56) : '—'}</td>
                    <td>{item.weightedDailyOutflow > 0 ? formatQuantity(item.weightedDailyOutflow) : '—'}</td>
                    <td>{item.daysToZero == null ? '—' : formatDaysToZero(item.daysToZero)}</td>
                    <td><span className={`badge ${item.statusTone}`}>{item.statusLabel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack gap-lg">
          <div className="card soft-card">
            <div className="section-title-row">
              <h2>Importy</h2>
              <span className="badge accent-badge">data</span>
            </div>
            <div className="stack compact">
              <div className="list-row"><span>Snapshot skladu</span><strong>{state.imports.stockSnapshotName || '—'}</strong></div>
              <div className="list-row"><span>Import snapshotu</span><strong>{state.imports.stockSnapshotAt ? formatDate(state.imports.stockSnapshotAt) : '—'}</strong></div>
              <div className="list-row"><span>Historie pohybů</span><strong>{state.imports.movementHistoryName || '—'}</strong></div>
              <div className="list-row"><span>Řádků pohybů</span><strong>{state.imports.importedMovementRowsCount || 0}</strong></div>
              <div className="list-row"><span>Období pohybů</span><strong>{state.imports.movementHistoryRange?.start ? `${formatDate(state.imports.movementHistoryRange.start)} – ${formatDate(state.imports.movementHistoryRange.end)}` : '—'}</strong></div>
            </div>
          </div>

          <div className="card soft-card">
            <div className="section-title-row">
              <h2>Kategorie</h2>
              <span className="badge">{inventory.categorySummary.length}</span>
            </div>
            <div className="table-wrap compact-table table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th>Produktů</th>
                    <th>K naskladnění</th>
                    <th>Do 14 dnů</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.categorySummary.slice(0, 12).map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{row.productCount}</td>
                      <td>{row.auditCount}</td>
                      <td>{row.soonCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

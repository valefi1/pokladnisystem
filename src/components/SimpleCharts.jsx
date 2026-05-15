import { formatCurrency, formatQuantity } from '../lib/format';

function getMax(items, accessor = (item) => item.value) {
  return Math.max(1, ...items.map((item) => Number(accessor(item)) || 0));
}

export function ColumnChart({ title, items, formatValue = (value) => value, colorClass = '' }) {
  const max = getMax(items);
  return (
    <div className="card chart-card">
      {title ? <div className="section-title-row"><h2>{title}</h2></div> : null}
      <div className="column-chart">
        {items.map((item) => {
          const height = Math.max(8, ((Number(item.value) || 0) / max) * 160);
          return (
            <div key={item.label} className="column-item">
              <div className="column-value">{formatValue(item.value)}</div>
              <div className={`column-bar ${colorClass}`} style={{ height }} title={`${item.label}: ${formatValue(item.value)}`} />
              <div className="column-label">{item.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProgressList({ title, items, formatValue = (value) => value, colorClass = '' }) {
  const max = getMax(items);
  return (
    <div className="card chart-card">
      {title ? <div className="section-title-row"><h2>{title}</h2></div> : null}
      <div className="progress-list">
        {items.map((item) => (
          <div key={item.label} className="progress-row">
            <div className="progress-row-top">
              <strong>{item.label}</strong>
              <span>{formatValue(item.value)}</span>
            </div>
            <div className="progress-track">
              <span className={`progress-fill ${colorClass}`} style={{ width: `${((Number(item.value) || 0) / max) * 100}%` }} />
            </div>
            {item.note ? <div className="table-subline">{item.note}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SegmentedStatus({ title, segments }) {
  const total = Math.max(1, segments.reduce((sum, segment) => sum + (Number(segment.value) || 0), 0));
  return (
    <div className="card chart-card">
      {title ? <div className="section-title-row"><h2>{title}</h2></div> : null}
      <div className="segment-bar">
        {segments.map((segment) => (
          <span
            key={segment.label}
            className={`segment ${segment.className || ''}`}
            style={{ width: `${((Number(segment.value) || 0) / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="segment-legend">
        {segments.map((segment) => (
          <div key={segment.label} className="segment-legend-item">
            <span className={`segment-dot ${segment.className || ''}`} />
            <span>{segment.label}</span>
            <strong>{segment.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function defaultPaymentLabel(method) {
  return {
    cash: 'Hotově',
    card: 'Karta',
    invoice: 'Faktura',
    voucher: 'Voucher',
  }[method] || method;
}

export function buildPaymentItems(sales) {
  const totals = new Map();
  sales.forEach((sale) => {
    totals.set(sale.paymentMethod, (totals.get(sale.paymentMethod) || 0) + (Number(sale.total) || 0));
  });
  return [...totals.entries()]
    .map(([method, value]) => ({ label: defaultPaymentLabel(method), value }))
    .sort((a, b) => b.value - a.value);
}

export function buildWeekdayItems(sales) {
  const labels = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  const buckets = labels.map((label) => ({ label, value: 0 }));
  sales.forEach((sale) => {
    const date = new Date(sale.createdAt);
    buckets[date.getDay()].value += Number(sale.total) || 0;
  });
  return [buckets[1], buckets[2], buckets[3], buckets[4], buckets[5], buckets[6], buckets[0]];
}

export function buildHourItems(sales) {
  const buckets = Array.from({ length: 11 }, (_, index) => ({ label: `${8 + index}:00`, value: 0 }));
  sales.forEach((sale) => {
    const hour = new Date(sale.createdAt).getHours();
    if (hour >= 8 && hour <= 18) buckets[hour - 8].value += Number(sale.total) || 0;
  });
  return buckets;
}

export const chartFormatters = {
  currency: formatCurrency,
  quantity: (value) => formatQuantity(value),
};

import { useMemo } from 'react';
import { formatCurrency } from '../lib/format';

export const CASH_DENOMINATIONS = [
  { value: 5000, label: '5 000 Kč', type: 'bankovka' },
  { value: 2000, label: '2 000 Kč', type: 'bankovka' },
  { value: 1000, label: '1 000 Kč', type: 'bankovka' },
  { value: 500, label: '500 Kč', type: 'bankovka' },
  { value: 200, label: '200 Kč', type: 'bankovka' },
  { value: 100, label: '100 Kč', type: 'bankovka' },
  { value: 50, label: '50 Kč', type: 'mince' },
  { value: 20, label: '20 Kč', type: 'mince' },
  { value: 10, label: '10 Kč', type: 'mince' },
  { value: 5, label: '5 Kč', type: 'mince' },
  { value: 2, label: '2 Kč', type: 'mince' },
  { value: 1, label: '1 Kč', type: 'mince' },
];

export function getCashBreakdownTotal(breakdown = {}) {
  return CASH_DENOMINATIONS.reduce((sum, denomination) => {
    const count = Math.max(0, Math.floor(Number(breakdown[denomination.value]) || 0));
    return sum + count * denomination.value;
  }, 0);
}

export function normalizeCashBreakdown(breakdown = {}) {
  return Object.fromEntries(
    CASH_DENOMINATIONS.map((denomination) => [
      String(denomination.value),
      Math.max(0, Math.floor(Number(breakdown[denomination.value] ?? breakdown[String(denomination.value)]) || 0)),
    ])
  );
}

export function CashCountForm({ value = {}, onChange, title = 'Přepočet hotovosti', note }) {
  const normalized = useMemo(() => normalizeCashBreakdown(value), [value]);
  const total = getCashBreakdownTotal(normalized);

  const updateCount = (denominationValue, rawValue) => {
    const nextCount = Math.max(0, Math.floor(Number(rawValue) || 0));
    onChange?.({ ...normalized, [String(denominationValue)]: nextCount });
  };

  const banknotes = CASH_DENOMINATIONS.filter((item) => item.type === 'bankovka');
  const coins = CASH_DENOMINATIONS.filter((item) => item.type === 'mince');

  const renderRows = (items) => items.map((denomination) => {
    const count = normalized[String(denomination.value)] || 0;
    const subtotal = count * denomination.value;
    return (
      <div key={denomination.value} className="cash-count-row">
        <span className="cash-count-denomination">{denomination.label}</span>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={count || ''}
          onChange={(event) => updateCount(denomination.value, event.target.value)}
          placeholder="0"
          aria-label={`Počet ${denomination.label}`}
        />
        <strong>{formatCurrency(subtotal)}</strong>
      </div>
    );
  });

  return (
    <div className="inner-card cash-count-card">
      <div className="section-title-row" style={{ marginBottom: '10px' }}>
        <div>
          <strong>{title}</strong>
          {note && <p className="muted" style={{ marginTop: '3px' }}>{note}</p>}
        </div>
        <strong style={{ fontSize: '20px' }}>{formatCurrency(total)}</strong>
      </div>
      <div className="cash-count-grid">
        <div>
          <p className="muted" style={{ marginBottom: '6px' }}>Bankovky</p>
          {renderRows(banknotes)}
        </div>
        <div>
          <p className="muted" style={{ marginBottom: '6px' }}>Mince</p>
          {renderRows(coins)}
        </div>
      </div>
    </div>
  );
}

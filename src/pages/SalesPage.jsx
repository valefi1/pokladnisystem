import { useMemo, useState } from 'react';
import { formatCurrency, formatDateTime } from '../lib/format';
import { paymentMethodLabel, printSaleDocument } from '../lib/receiptPrint';
import { CashCountForm, getCashBreakdownTotal, normalizeCashBreakdown } from '../components/CashCountForm';

const PERIODS = [
  { id: 'today',   label: 'Dnes' },
  { id: 'week',    label: 'Tento týden' },
  { id: 'month',   label: 'Tento měsíc' },
  { id: 'year',    label: 'Letos' },
  { id: 'all',     label: 'Vše' },
];

const METHOD_LABELS = {
  card: 'Karta', cash: 'Hotovost', transfer: 'Převod',
  voucher: 'Voucher', invoice: 'Faktura', unpaid: 'Nezaplaceno', split: 'Rozdělená',
};

function periodStart(id) {
  const now = new Date();
  if (id === 'today') { const d = new Date(now); d.setHours(0,0,0,0); return d; }
  if (id === 'week')  { const d = new Date(now); d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1)); d.setHours(0,0,0,0); return d; }
  if (id === 'month') { return new Date(now.getFullYear(), now.getMonth(), 1); }
  if (id === 'year')  { return new Date(now.getFullYear(), 0, 1); }
  return null;
}

function groupByDay(sales) {
  const map = new Map();
  for (const s of sales) {
    const key = s.createdAt.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function groupByMonth(sales) {
  const map = new Map();
  for (const s of sales) {
    const key = s.createdAt.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function getLastClosedCashSession(cashSessions = [], activeCashSession) {
  return [...cashSessions]
    .filter((session) => session.closedAt && session.id !== activeCashSession?.id)
    .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())[0] || null;
}

function DifferenceLabel({ amount }) {
  const value = Number(amount) || 0;
  return (
    <strong style={{color: value === 0 ? 'var(--color-text)' : value < 0 ? 'var(--color-text-danger)' : 'var(--color-text-warning)'}}>
      {formatCurrency(value)} {value < 0 ? '· manko' : value > 0 ? '· přebytek' : '· sedí'}
    </strong>
  );
}

function ZReport({ sales, cashSessions = [], activeCashSession, activeSummary, onClose, onOpenCashRegister, onCloseCashRegister }) {
  const [openingBreakdown, setOpeningBreakdown] = useState({});
  const [openingNote, setOpeningNote] = useState('');
  const [openedBy, setOpenedBy] = useState('');
  const [closingBreakdown, setClosingBreakdown] = useState({});
  const [closingNote, setClosingNote] = useState('');
  const [closedBy, setClosedBy] = useState('');

  const lastClosedSession = getLastClosedCashSession(cashSessions, activeCashSession);
  const openingCash = getCashBreakdownTotal(openingBreakdown);
  const previousClosingCash = lastClosedSession ? Number(lastClosedSession.countedCash ?? lastClosedSession.expectedCash ?? 0) || 0 : 0;
  const openingDifference = lastClosedSession ? openingCash - previousClosingCash : 0;

  const sessionSales = activeSummary?.sales || [];
  const revenue = sessionSales.filter(s => !s.unpaid).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
  const byMethod = {};
  for (const s of sessionSales) {
    if (s.unpaid) continue;
    const m = s.paymentMethod || 'other';
    byMethod[m] = (byMethod[m] || 0) + (Number(s.total) || 0);
  }
  const tips = sessionSales.reduce((sum, s) => sum + (s.tipAmount || 0), 0);
  const expectedCash = Number(activeSummary?.expectedCash) || 0;
  const counted = getCashBreakdownTotal(closingBreakdown);
  const difference = counted - expectedCash;

  const handleOpen = () => {
    if (!onOpenCashRegister) return;
    onOpenCashRegister({
      businessDate: new Date().toISOString().slice(0, 10),
      openingCash,
      openingCashBreakdown: normalizeCashBreakdown(openingBreakdown),
      expectedOpeningCash: lastClosedSession ? previousClosingCash : null,
      openingDifference: lastClosedSession ? openingDifference : null,
      previousCashSessionId: lastClosedSession?.id || '',
      openingNote,
      openedBy,
    });
    onClose();
  };

  const handleCloseRegister = () => {
    if (!onCloseCashRegister) return;
    onCloseCashRegister({
      countedCash: counted,
      closingCashBreakdown: normalizeCashBreakdown(closingBreakdown),
      closingNote,
      closedBy,
    });
    onClose();
  };

  if (!activeCashSession) {
    return (
      <div className="modal-backdrop">
        <div className="modal wide-modal">
          <div className="modal-header">
            <h3>Otevření pokladny</h3>
            <button className="ghost-button" onClick={onClose}>✕</button>
          </div>
          <div className="stack compact">
            <p className="muted">Na začátku prodejního dne zadej počet jednotlivých bankovek a mincí. Systém z nich spočítá počáteční hotovost a porovná ji s posledním zavřením kasy.</p>
            {lastClosedSession ? (
              <div className="inner-card">
                <div className="list-row"><span>Poslední zavření</span><strong>{formatDateTime(lastClosedSession.closedAt)}</strong></div>
                <div className="list-row"><span>Hotovost při posledním zavření</span><strong>{formatCurrency(previousClosingCash)}</strong></div>
                <div className="list-row"><span>Rozdíl proti dnešnímu přepočtu</span><DifferenceLabel amount={openingDifference} /></div>
              </div>
            ) : (
              <div className="inner-card"><p className="muted">Zatím není uložené žádné předchozí zavření. První otevření nebude s čím porovnat.</p></div>
            )}
            <CashCountForm
              title="Počáteční hotovost v kase"
              note="Zadej kusy jednotlivých nominálů. Celková částka se vypočítá automaticky."
              value={openingBreakdown}
              onChange={setOpeningBreakdown}
            />
            <div className="form-grid">
              <label>Otevřel/a
                <input value={openedBy} onChange={(e) => setOpenedBy(e.target.value)} placeholder="jméno obsluhy" />
              </label>
              <label>Poznámka k otevření
                <input value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} placeholder="např. důvod rozdílu" />
              </label>
            </div>
            <button className="primary-button full-width" onClick={handleOpen}>Otevřít pokladnu s {formatCurrency(openingCash)}</button>
            <button className="ghost-button full-width" onClick={onClose}>Zavřít</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal">
        <div className="modal-header">
          <div>
            <h3>Zavření pokladny / Z-report</h3>
            <p className="muted">Otevřeno {formatDateTime(activeCashSession.openedAt)}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>✕</button>
        </div>
        <div className="stack compact">
          <div className="inner-card">
            <div className="list-row"><span>Počáteční hotovost</span><strong>{formatCurrency(activeCashSession.openingCash || 0)}</strong></div>
            {activeCashSession.expectedOpeningCash != null && <div className="list-row"><span>Rozdíl při otevření proti předchozímu zavření</span><DifferenceLabel amount={activeCashSession.openingDifference || 0} /></div>}
            <div className="list-row"><span>Hotovostní prodeje</span><strong>{formatCurrency(activeSummary?.totalCashSales || 0)}</strong></div>
            <div className="list-row"><span>Očekávaná hotovost v kase</span><strong>{formatCurrency(expectedCash)}</strong></div>
          </div>
          <div className="inner-card">
            <div className="list-row"><span>Celková tržba od otevření</span><strong>{formatCurrency(revenue)}</strong></div>
            <div className="list-row"><span>Počet zaplacených dokladů</span><strong>{sessionSales.filter(s=>!s.unpaid).length}</strong></div>
            {tips > 0 && <div className="list-row"><span>Spropitné celkem</span><strong>{formatCurrency(tips)}</strong></div>}
            <div className="list-row"><span>Nezaplaceno</span><strong>{sessionSales.filter(s=>s.unpaid).length} dokladů</strong></div>
          </div>
          <div className="inner-card">
            <p className="muted" style={{marginBottom:'8px'}}>Podle platební metody</p>
            {Object.entries(byMethod).length === 0 ? <p className="muted">Zatím žádné prodeje v této otevřené pokladně.</p> : null}
            {Object.entries(byMethod).map(([m, total]) => (
              <div key={m} className="list-row">
                <span>{METHOD_LABELS[m] || m}</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
            ))}
          </div>
          <CashCountForm
            title="Hotovost fyzicky v kase při zavření"
            note="Zadej kusy bankovek a mincí po přepočtu kasy."
            value={closingBreakdown}
            onChange={setClosingBreakdown}
          />
          <div className="form-grid">
            <label>Zavřel/a
              <input value={closedBy} onChange={(e) => setClosedBy(e.target.value)} placeholder="jméno obsluhy" />
            </label>
            <label>Poznámka k zavření
              <input value={closingNote} onChange={(e) => setClosingNote(e.target.value)} placeholder="např. důvod rozdílu" />
            </label>
          </div>
          <div className="inner-card">
            <div className="list-row"><span>Spočítaná hotovost</span><strong>{formatCurrency(counted)}</strong></div>
            <div className="list-row"><span>Očekávaná hotovost</span><strong>{formatCurrency(expectedCash)}</strong></div>
            <div className="list-row"><span>Rozdíl po přepočtu</span><DifferenceLabel amount={difference} /></div>
          </div>
          <button className="primary-button full-width" onClick={handleCloseRegister}>Zavřít pokladnu</button>
          <button className="ghost-button full-width" onClick={() => window.print()}>Tisknout Z-report</button>
          <button className="ghost-button full-width" onClick={onClose}>Zpět</button>
        </div>
      </div>
    </div>
  );
}

function SaleDetail({ sale, onClose }) {
  const handlePrint = () => {
    printSaleDocument({
      createdAt: sale.createdAt,
      documentNumber: sale.documentNumber,
      items: sale.items,
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      cashReceived: sale.cashReceived,
      change: sale.change,
      invoiceCustomer: sale.invoiceCustomer,
      invoiceDueDate: sale.invoiceDueDate,
      voucherLabel: sale.voucherLabel,
      note: sale.note,
    });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <div>
            <h3>{sale.documentNumber}</h3>
            <p className="muted">{formatDateTime(sale.createdAt)}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>✕</button>
        </div>
        <div className="stack compact">
          <div className="inner-card">
            {(sale.items || []).map((item, i) => (
              <div key={i} className="list-row">
                <span>{item.name} × {item.quantity} {item.unit}</span>
                <strong>{formatCurrency(item.price * item.quantity)}</strong>
              </div>
            ))}
            <div className="list-row" style={{borderTop:'0.5px solid var(--color-border-tertiary)',paddingTop:'6px',marginTop:'4px'}}>
              <span>Celkem</span>
              <strong style={{fontSize:'18px'}}>{formatCurrency(sale.total)}</strong>
            </div>
            {sale.tipAmount > 0 && <div className="list-row"><span>Spropitné</span><strong>+{formatCurrency(sale.tipAmount)}</strong></div>}
          </div>
          <div className="inner-card">
            <div className="list-row"><span>Platba</span><strong>{METHOD_LABELS[sale.paymentMethod] || sale.paymentMethod}</strong></div>
            {sale.paymentMethod === 'cash' && <div className="list-row"><span>Přijato</span><strong>{formatCurrency(sale.cashReceived)}</strong></div>}
            {sale.paymentMethod === 'cash' && <div className="list-row"><span>Vráceno</span><strong>{formatCurrency(sale.change)}</strong></div>}
            {sale.invoiceCustomer && <div className="list-row"><span>Faktura pro</span><strong>{sale.invoiceCustomer}</strong></div>}
            {sale.voucherLabel && <div className="list-row"><span>Voucher</span><strong>{sale.voucherLabel}</strong></div>}
            {sale.terminalReference && <div className="list-row"><span>Terminál ref.</span><strong>{sale.terminalReference}</strong></div>}
            {sale.terminalApprovalCode && <div className="list-row"><span>Auth kód</span><strong>{sale.terminalApprovalCode}</strong></div>}
            {sale.unpaid && <div className="list-row"><span>Stav</span><strong style={{color:'var(--color-text-warning)'}}>NEZAPLACENO</strong></div>}
            {sale.note && <div className="list-row"><span>Poznámka</span><span>{sale.note}</span></div>}
            {sale.email && <div className="list-row"><span>E-mail</span><span>{sale.email}</span></div>}
          </div>
          {sale.splitLegs && sale.splitLegs.length > 0 && (
            <div className="inner-card">
              <p className="muted" style={{marginBottom:'6px'}}>Rozdělená platba</p>
              {sale.splitLegs.map((leg, i) => (
                <div key={i} className="list-row">
                  <span>{METHOD_LABELS[leg.method] || leg.method}</span>
                  <strong>{formatCurrency(leg.amount)}</strong>
                </div>
              ))}
            </div>
          )}
          <button className="ghost-button full-width" onClick={handlePrint}>🖨 Znovu vytisknout</button>
          <button className="ghost-button full-width" onClick={onClose}>Zavřít</button>
        </div>
      </div>
    </div>
  );
}

export function SalesPage({ sales = [], dayClosures = [], cashSessions = [], activeCashSession, activeCashSessionSummary, onOpenCashRegister, onCloseCashRegister, onCloseDay }) {
  const [period, setPeriod] = useState('today');
  const [grouping, setGrouping] = useState('day');
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [zReport, setZReport] = useState(false);

  const filtered = useMemo(() => {
    const start = periodStart(period);
    return sales.filter(s => {
      if (start && new Date(s.createdAt) < start) return false;
      if (methodFilter !== 'all' && s.paymentMethod !== methodFilter) return false;
      if (search) {
        const hay = `${s.documentNumber} ${s.invoiceCustomer} ${s.note} ${(s.items||[]).map(i=>i.name).join(' ')}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [sales, period, methodFilter, search]);

  const revenue = filtered.filter(s=>!s.unpaid).reduce((sum, s) => sum + s.total, 0);
  const tips = filtered.reduce((sum, s) => sum + (s.tipAmount || 0), 0);
  const avgBasket = filtered.filter(s=>!s.unpaid).length > 0 ? revenue / filtered.filter(s=>!s.unpaid).length : 0;

  const grouped = useMemo(() => grouping === 'day' ? groupByDay(filtered) : groupByMonth(filtered), [filtered, grouping]);

  const exportCsv = () => {
    const rows = [['Doklad','Datum','Metoda','Celkem','Spropitné','Zákazník','Poznámka']];
    for (const s of filtered) {
      rows.push([s.documentNumber, s.createdAt.slice(0,16), s.paymentMethod, s.total.toFixed(2), (s.tipAmount||0).toFixed(2), s.invoiceCustomer||'', s.note||'']);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trzby-${period}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>Tržby a přehledy</h1>
          <p className="muted">Historie dokladů, denní / měsíční / roční přehledy a uzávěrka.</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={() => setZReport(true)}>{activeCashSession ? 'Zavřít pokladnu / Z-report' : 'Otevřít pokladnu'}</button>
          <button className="ghost-button" onClick={exportCsv}>Export CSV</button>
        </div>
      </section>

      {/* Period tabs */}
      <div className="toolbar">
        <div className="category-tabs">
          {PERIODS.map(p => (
            <button key={p.id} className={`tab-pill ${period === p.id ? 'active' : ''}`} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="toggle-row">
          <button className={`toggle-pill compact-pill ${grouping === 'day' ? 'active' : ''}`} onClick={() => setGrouping('day')}>Den</button>
          <button className={`toggle-pill compact-pill ${grouping === 'month' ? 'active' : ''}`} onClick={() => setGrouping('month')}>Měsíc</button>
        </div>
      </div>

      {/* Stat cards */}
      <section className="stats-grid analytics-stats-grid">
        <div className="card stat-card accent-card">
          <p className="eyebrow">Tržba</p>
          <strong className="stat-value">{formatCurrency(revenue)}</strong>
          <p className="muted">{filtered.filter(s=>!s.unpaid).length} dokladů</p>
        </div>
        <div className="card stat-card">
          <p className="eyebrow">Průměrný nákup</p>
          <strong className="stat-value">{formatCurrency(avgBasket)}</strong>
        </div>
        {tips > 0 && (
          <div className="card stat-card">
            <p className="eyebrow">Spropitné</p>
            <strong className="stat-value">{formatCurrency(tips)}</strong>
          </div>
        )}
        <div className="card stat-card">
          <p className="eyebrow">Nezaplaceno</p>
          <strong className="stat-value">{filtered.filter(s=>s.unpaid).length}</strong>
        </div>
      </section>

      {/* Filtry */}
      <div className="toolbar">
        <input className="search-input" placeholder="Hledat doklad, zákazníka, produkt…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="category-tabs">
          {['all','card','cash','transfer','invoice','voucher','unpaid'].map(m => (
            <button key={m} className={`tab-pill ${methodFilter === m ? 'active' : ''}`} onClick={() => setMethodFilter(m)}>
              {m === 'all' ? 'Vše' : (METHOD_LABELS[m] || m)}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped sales */}
      <div className="stack gap-lg">
        {grouped.length === 0 && <p className="muted">Žádné doklady za vybrané období.</p>}
        {grouped.map(([key, daySales]) => {
          const dayRev = daySales.filter(s=>!s.unpaid).reduce((sum,s)=>sum+s.total,0);
          const label = grouping === 'month'
            ? new Date(key+'-01').toLocaleDateString('cs-CZ', {month:'long', year:'numeric'})
            : new Date(key).toLocaleDateString('cs-CZ', {weekday:'long', day:'numeric', month:'long'});
          return (
            <div key={key} className="card soft-card">
              <div className="section-title-row" style={{marginBottom:'8px'}}>
                <strong>{label}</strong>
                <span>{formatCurrency(dayRev)} · {daySales.length} dokladů</span>
              </div>
              <div className="table-wrap table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Doklad</th>
                      <th>Čas</th>
                      <th>Platba</th>
                      <th>Položky</th>
                      <th style={{textAlign:'right'}}>Celkem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daySales.map(s => (
                      <tr key={s.id} style={{cursor:'pointer'}} onClick={() => setSelected(s)}>
                        <td><strong>{s.documentNumber}</strong></td>
                        <td className="muted">{s.createdAt.slice(11,16)}</td>
                        <td>
                          <span className={`badge ${s.unpaid ? 'danger-badge' : s.paymentMethod === 'card' ? 'accent-badge' : ''}`}>
                            {METHOD_LABELS[s.paymentMethod] || s.paymentMethod}
                          </span>
                        </td>
                        <td className="muted">{(s.items||[]).slice(0,3).map(i=>i.name).join(', ')}{(s.items||[]).length > 3 ? '…' : ''}</td>
                        <td style={{textAlign:'right'}}><strong>{formatCurrency(s.total)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── DPH breakdown tabulka (obr. 6) ── */}
      {filtered.filter(s=>!s.unpaid).length > 0 && (
        <div className="card">
          <div className="section-title-row" style={{marginBottom:'12px'}}>
            <strong>Přehled tržeb s DPH</strong>
            <span className="muted" style={{fontSize:'12px'}}>za vybrané období</span>
          </div>
          <div className="table-wrap table-shell">
            <table>
              <thead>
                <tr>
                  <th>Sazba DPH</th><th>Měna</th>
                  <th style={{textAlign:'right'}}>Tržba bez DPH</th>
                  <th style={{textAlign:'right'}}>Tržba s DPH</th>
                  <th style={{textAlign:'right'}}>Celkem DPH</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const vat = {'0%':0,'12%':0,'21%':0};
                  for (const s of filtered.filter(x=>!x.unpaid)) {
                    for (const item of (s.items||[])) {
                      const r = Number(item.vatRate)||12;
                      const k = r===0?'0%':r===21?'21%':'12%';
                      vat[k] = (vat[k]||0) + (Number(item.lineTotalWithoutVat) || netFromGross((Number(item.lineTotal) || Number(item.price) * Number(item.quantity)), r));
                    }
                  }
                  const totalBase = Object.values(vat).reduce((s,v)=>s+v,0);
                  return Object.entries(vat).map(([rate,base])=>{
                    const pct=parseFloat(rate)/100;
                    const withVat=base*(1+pct);
                    const vatAmt=withVat-base;
                    return (
                      <tr key={rate}>
                        <td><strong>{rate}</strong></td><td>CZK</td>
                        <td style={{textAlign:'right'}}>{formatCurrency(base)}</td>
                        <td style={{textAlign:'right'}}>{formatCurrency(withVat)}</td>
                        <td style={{textAlign:'right'}}>{formatCurrency(vatAmt)}</td>
                      </tr>
                    );
                  }).concat([
                    <tr key="total" style={{borderTop:'1.5px solid var(--color-border-secondary)',fontWeight:500}}>
                      <td>Zaokrouhlení + celkem</td><td>CZK</td>
                      <td style={{textAlign:'right'}}>{formatCurrency(totalBase)}</td>
                      <td style={{textAlign:'right'}}>{formatCurrency(revenue)}</td>
                      <td style={{textAlign:'right'}}>{formatCurrency(revenue - totalBase)}</td>
                    </tr>
                  ]);
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tržby dle kategorií ── */}
      {filtered.filter(s=>!s.unpaid).length > 0 && (() => {
        const catMap = {};
        for (const s of filtered.filter(x=>!x.unpaid)) {
          for (const item of (s.items||[])) {
            const cat = item.category || 'Nezařazeno';
            if (!catMap[cat]) catMap[cat] = {revenue:0,qty:0};
            catMap[cat].revenue += item.price*item.quantity;
            catMap[cat].qty += item.quantity;
          }
        }
        const cats = Object.entries(catMap).sort((a,b)=>b[1].revenue-a[1].revenue);
        if (!cats.length) return null;
        const maxRev = cats[0][1].revenue;
        return (
          <div className="card">
            <p className="eyebrow" style={{marginBottom:'12px'}}>Tržby dle kategorií</p>
            {cats.map(([cat, d]) => (
              <div key={cat} style={{marginBottom:'8px'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',marginBottom:'3px'}}>
                  <span>{cat}</span>
                  <span style={{fontWeight:500}}>{formatCurrency(d.revenue)}</span>
                </div>
                <div style={{height:'4px',background:'var(--color-border-tertiary)',borderRadius:'2px'}}>
                  <div style={{height:'4px',width:`${Math.round(d.revenue/maxRev*100)}%`,background:'#1D9E75',borderRadius:'2px'}} />
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {selected && <SaleDetail sale={selected} onClose={() => setSelected(null)} />}
      <div className="card soft-card">
        <div className="section-title-row" style={{marginBottom:'8px'}}>
          <strong>Poslední pokladní směny</strong>
          <span className="muted">{cashSessions.length}</span>
        </div>
        {cashSessions.slice(0, 5).map((session) => (
          <div key={session.id} className="list-row">
            <span>{session.businessDate} · {session.closedAt ? 'zavřeno' : 'otevřeno'}</span>
            <strong>{session.closedAt ? `${formatCurrency(session.totalRevenue || 0)} · rozdíl ${formatCurrency(session.cashDifference || 0)}` : `start ${formatCurrency(session.openingCash || 0)}`}</strong>
          </div>
        ))}
        {cashSessions.length === 0 && <p className="muted">Zatím žádná otevřená ani zavřená pokladna.</p>}
      </div>

      {zReport && <ZReport sales={sales} cashSessions={cashSessions} activeCashSession={activeCashSession} activeSummary={activeCashSessionSummary} onClose={() => setZReport(false)} onOpenCashRegister={onOpenCashRegister} onCloseCashRegister={onCloseCashRegister} onCloseDay={onCloseDay} />}
    </div>
  );
}

import { useMemo } from 'react';
import { formatCurrency, formatDateTime } from '../lib/format';
import { paymentMethodLabel, printSaleDocument } from '../lib/receiptPrint';

const METHOD_LABELS = {
  card:'Karta', cash:'Hotovost', transfer:'Převod',
  voucher:'Voucher', invoice:'Faktura', unpaid:'Nezaplaceno', split:'Rozdělená',
};

const WEEK_DAYS = ['Po','Út','St','Čt','Pá','So','Ne'];

function MiniBarChart({ values, labels, color = '#1D9E75' }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:'4px',height:'60px',paddingBottom:'20px',position:'relative'}}>
      {values.map((v,i) => (
        <div key={i} style={{display:'flex',flexDirection:'column',alignItems:'center',flex:1,gap:'2px'}}>
          <div style={{width:'100%',background:v>0?color:'var(--color-border-tertiary)',borderRadius:'2px 2px 0 0',height:`${Math.round((v/max)*44)+2}px`,transition:'height 0.3s'}} />
          <span style={{fontSize:'10px',color:'var(--color-text-secondary)',lineHeight:1}}>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ values, color = '#1D9E75' }) {
  const max = Math.max(...values, 1);
  const w = 320; const h = 80; const pad = 8;
  const pts = values.map((v,i) => {
    const x = pad + (i/(values.length-1||1))*(w-pad*2);
    const y = h - pad - ((v/max)*(h-pad*2));
    return `${x},${y}`;
  }).join(' ');
  const area = `M ${pad},${h-pad} ` + values.map((v,i) => {
    const x = pad + (i/(values.length-1||1))*(w-pad*2);
    const y = h - pad - ((v/max)*(h-pad*2));
    return `L ${x},${y}`;
  }).join(' ') + ` L ${w-pad},${h-pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:'80px'}}>
      <path d={area} fill={color} fillOpacity="0.12" stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  );
}

export function DashboardPage({ state, derived, onResetDemo }) {
  const { todayRevenue, weekRevenue, monthRevenue, yearRevenue,
          todaySalesCount, weekSalesCount, monthSalesCount,
          paymentBreakdown, vatBreakdown, totalStockValue,
          hourlyRevenue, weekDayRevenue, inventory } = derived;

  // Latest 5 sales
  const latestSales = state.sales.slice(0, 5);

  // Hourly chart — only hours 7-21
  const hourLabels = Array.from({length:15},(_,i)=>`${i+7}`);
  const hourValues = hourLabels.map(h => hourlyRevenue[Number(h)] || 0);

  // Top products this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const topProducts = useMemo(() => {
    const map = {};
    for (const s of state.sales) {
      if (new Date(s.createdAt) < monthStart || s.unpaid) continue;
      for (const item of (s.items||[])) {
        if (!map[item.name]) map[item.name] = { name: item.name, qty: 0, revenue: 0 };
        map[item.name].qty += item.quantity;
        map[item.name].revenue += item.price * item.quantity;
      }
    }
    return Object.values(map).sort((a,b)=>b.revenue-a.revenue).slice(0,6);
  }, [state.sales]);

  const maxTopRev = Math.max(...topProducts.map(p=>p.revenue), 1);

  // Tržby přes Dotypay
  const dotypayToday = state.sales
    .filter(s => !s.unpaid && s.terminalProvider === 'Dotypay' && new Date(s.createdAt) >= new Date(new Date().setHours(0,0,0,0)))
    .reduce((s,x)=>s+x.total, 0);
  const dotypayWeek = state.sales
    .filter(s => !s.unpaid && s.terminalProvider === 'Dotypay')
    .reduce((s,x)=>s+x.total, 0);

  return (
    <div className="page-stack">
      {/* Header */}
      <section className="page-header panel-header">
        <div>
          <p className="eyebrow">Šumperská Špajzka · webová pokladna</p>
          <h1>Přehled</h1>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={onResetDemo}>Obnovit demo data</button>
        </div>
      </section>

      {/* ── Tržby dle období (obr. 9 vpravo) ── */}
      <div className="dashboard-main-grid">

        {/* Levý sloupec — graf + hodinové */}
        <div className="stack gap-lg" style={{minWidth:0}}>

          {/* Graf denních tržeb */}
          <div className="card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Denní tržby</p>
                <strong style={{fontSize:'22px'}}>{formatCurrency(weekRevenue)}</strong>
                <span className="muted" style={{marginLeft:'8px',fontSize:'13px'}}>tento týden</span>
              </div>
            </div>
            <MiniBarChart values={weekDayRevenue} labels={WEEK_DAYS} color="#1D9E75" />
          </div>

          {/* Hodinové tržby */}
          <div className="card">
            <p className="eyebrow" style={{marginBottom:'8px'}}>Hodinové tržby — dnes</p>
            <LineChart values={hourValues} color="#1D9E75" />
            <div style={{display:'flex',justifyContent:'space-between',marginTop:'4px'}}>
              <span style={{fontSize:'11px',color:'var(--color-text-secondary)'}}>07:00</span>
              <span style={{fontSize:'11px',color:'var(--color-text-secondary)'}}>21:00</span>
            </div>
          </div>

          {/* Hodnota pokladny */}
          <div className="card">
            <p className="eyebrow" style={{marginBottom:'8px'}}>Hodnota pokladny (hotovost)</p>
            {(() => {
              const cashIn = state.sales.filter(s=>s.paymentMethod==='cash'&&!s.unpaid).reduce((s,x)=>s+(x.cashReceived||0),0);
              const cashOut = state.sales.filter(s=>s.paymentMethod==='cash'&&!s.unpaid).reduce((s,x)=>s+(x.change||0),0);
              const tips = state.sales.reduce((s,x)=>s+(x.tipAmount||0),0);
              return (
                <div className="stack compact">
                  <div className="list-row"><span>Přijaté platby (hotovost)</span><strong>{formatCurrency(cashIn)}</strong></div>
                  <div className="list-row"><span>Vydané (vráceno)</span><strong style={{color:'var(--color-text-danger)'}}>−{formatCurrency(cashOut)}</strong></div>
                  {tips>0 && <div className="list-row"><span>Spropitné</span><strong>{formatCurrency(tips)}</strong></div>}
                  <div className="list-row" style={{borderTop:'0.5px solid var(--color-border-tertiary)',paddingTop:'6px',marginTop:'2px'}}>
                    <strong>Celkem v pokladně</strong>
                    <strong style={{fontSize:'18px'}}>{formatCurrency(cashIn - cashOut)}</strong>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Pravý sloupec */}
        <div className="stack gap-lg" style={{minWidth:0}}>

          {/* Tržby dle období — tabulka jako v Dotykačce */}
          <div className="card">
            <div className="section-title-row" style={{marginBottom:'12px'}}>
              <strong>Tržby</strong>
            </div>
            <table style={{width:'100%',fontSize:'14px',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',fontWeight:500,color:'var(--color-text-secondary)',paddingBottom:'6px',fontSize:'12px'}}>Období</th>
                  <th style={{textAlign:'right',fontWeight:500,color:'var(--color-text-secondary)',paddingBottom:'6px',fontSize:'12px'}}>Tržba</th>
                  <th style={{textAlign:'right',fontWeight:500,color:'var(--color-text-secondary)',paddingBottom:'6px',fontSize:'12px'}}>Doklady</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {label:'Dnes', rev: todayRevenue, cnt: todaySalesCount},
                  {label:'Tento týden', rev: weekRevenue, cnt: weekSalesCount},
                  {label:'Tento měsíc', rev: monthRevenue, cnt: monthSalesCount},
                  {label:'Letos', rev: yearRevenue, cnt: state.sales.filter(s=>!s.unpaid&&new Date(s.createdAt)>=new Date(new Date().getFullYear(),0,1)).length},
                ].map(row => (
                  <tr key={row.label} style={{borderTop:'0.5px solid var(--color-border-tertiary)'}}>
                    <td style={{padding:'8px 0',color:'var(--color-text-primary)'}}>{row.label}</td>
                    <td style={{padding:'8px 0',textAlign:'right',fontWeight:500}}>{formatCurrency(row.rev)}</td>
                    <td style={{padding:'8px 0',textAlign:'right',color:'var(--color-text-secondary)'}}>{row.cnt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tržby dle platební metody */}
          <div className="card">
            <p className="eyebrow" style={{marginBottom:'8px'}}>Tržby dle platebních metod — tento měsíc</p>
            {Object.keys(paymentBreakdown).length === 0
              ? <p className="muted">Zatím žádné prodeje.</p>
              : Object.entries(paymentBreakdown).sort((a,b)=>b[1]-a[1]).map(([m,v])=>{
                const pct = Math.round(v/monthRevenue*100)||0;
                return (
                  <div key={m} style={{marginBottom:'8px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',marginBottom:'3px'}}>
                      <span>{METHOD_LABELS[m]||m}</span>
                      <span style={{fontWeight:500}}>{formatCurrency(v)} <span style={{color:'var(--color-text-secondary)',fontWeight:400}}>({pct}%)</span></span>
                    </div>
                    <div style={{height:'4px',background:'var(--color-border-tertiary)',borderRadius:'2px'}}>
                      <div style={{height:'4px',width:`${pct}%`,background:'#1D9E75',borderRadius:'2px'}} />
                    </div>
                  </div>
                );
              })
            }
          </div>

          {/* Tržby přes Dotypay */}
          <div className="card">
            <div className="section-title-row" style={{marginBottom:'8px'}}>
              <strong>Tržby přes Dotypay</strong>
            </div>
            <div className="list-row"><span>Dnes</span><strong>{formatCurrency(dotypayToday)}</strong></div>
            <div className="list-row"><span>Celkem</span><strong>{formatCurrency(dotypayWeek)}</strong></div>
          </div>

          {/* Sklad — rychlý přehled */}
          <div className="card">
            <p className="eyebrow" style={{marginBottom:'8px'}}>Stav skladu</p>
            <div className="list-row"><span>Hodnota skladu</span><strong>{formatCurrency(totalStockValue)}</strong></div>
            <div className="list-row"><span>K naskladnění (nula/mínus)</span><strong style={{color:'var(--color-text-danger)'}}>{inventory.auditQueue.length}</strong></div>
            <div className="list-row"><span>Vyprodá se do 3 dnů</span><strong style={{color:'var(--color-text-warning)'}}>{inventory.dueIn3.length}</strong></div>
          </div>
        </div>
      </div>

      {/* ── Přehled tržeb s DPH breakdownem (obr. 6) ── */}
      <div className="card">
        <div className="section-title-row" style={{marginBottom:'12px'}}>
          <strong>Přehled tržeb s DPH — tento měsíc</strong>
        </div>
        <div className="table-wrap table-shell">
          <table>
            <thead>
              <tr>
                <th>Sazba DPH</th>
                <th>Měna</th>
                <th style={{textAlign:'right'}}>Tržba bez DPH</th>
                <th style={{textAlign:'right'}}>Tržba s DPH</th>
                <th style={{textAlign:'right'}}>Celkem DPH</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(vatBreakdown).map(([rate, base]) => {
                const pct = parseFloat(rate)/100;
                const withVat = base * (1 + pct);
                const vatAmt = withVat - base;
                return (
                  <tr key={rate}>
                    <td><strong>{rate}</strong></td>
                    <td>CZK</td>
                    <td style={{textAlign:'right'}}>{formatCurrency(base)}</td>
                    <td style={{textAlign:'right'}}>{formatCurrency(withVat)}</td>
                    <td style={{textAlign:'right'}}>{formatCurrency(vatAmt)}</td>
                  </tr>
                );
              })}
              <tr style={{borderTop:'1.5px solid var(--color-border-secondary)',fontWeight:500}}>
                <td>Celkem</td>
                <td>CZK</td>
                <td style={{textAlign:'right'}}>{formatCurrency(Object.values(vatBreakdown).reduce((s,v)=>s+v,0))}</td>
                <td style={{textAlign:'right'}}>{formatCurrency(monthRevenue)}</td>
                <td style={{textAlign:'right'}}>{formatCurrency(monthRevenue - Object.values(vatBreakdown).reduce((s,v)=>s+v,0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{marginTop:'8px',fontSize:'12px'}}>DPH sazba se bere z pole vatRate na produktu (výchozí 12 %). Nastav sazby u produktů pro přesné výpočty.</p>
      </div>

      {/* ── Nejprodávanější produkty ── */}
      {topProducts.length > 0 && (
        <div className="card">
          <p className="eyebrow" style={{marginBottom:'12px'}}>Nejprodávanější produkty — tento měsíc</p>
          <div className="stack compact">
            {topProducts.map(p => (
              <div key={p.name} style={{marginBottom:'6px'}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:'13px',marginBottom:'3px'}}>
                  <span>{p.name}</span>
                  <span style={{fontWeight:500}}>{formatCurrency(p.revenue)}</span>
                </div>
                <div style={{height:'4px',background:'var(--color-border-tertiary)',borderRadius:'2px'}}>
                  <div style={{height:'4px',width:`${Math.round(p.revenue/maxTopRev*100)}%`,background:'#0F6E56',borderRadius:'2px'}} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Poslední doklady ── */}
      <div className="card">
        <div className="section-title-row" style={{marginBottom:'8px'}}>
          <strong>Poslední doklady</strong>
        </div>
        {latestSales.length === 0 ? <p className="muted">Zatím žádné prodeje.</p> : (
          <div className="table-wrap table-shell">
            <table>
              <thead>
                <tr>
                  <th>Doklad</th><th>Čas</th><th>Metoda</th><th style={{textAlign:'right'}}>Celkem</th>
                </tr>
              </thead>
              <tbody>
                {latestSales.map(s => (
                  <tr key={s.id}>
                    <td><strong>{s.documentNumber}</strong></td>
                    <td className="muted">{s.createdAt?.slice(0,16).replace('T',' ')}</td>
                    <td><span className={`badge ${s.unpaid?'danger-badge':s.paymentMethod==='card'?'accent-badge':''}`}>{METHOD_LABELS[s.paymentMethod]||s.paymentMethod}</span></td>
                    <td style={{textAlign:'right'}}><strong>{formatCurrency(s.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

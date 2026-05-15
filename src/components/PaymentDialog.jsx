import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../lib/format';
import { loadDevicePrefs } from '../lib/devicePrefs';
import { runDotypayPayment } from '../lib/dotypay';
import { addDeviceLog } from '../lib/deviceDebug';

function createInvoiceDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

const BANKNOTE_SUGGESTIONS = [50, 100, 200, 500, 1000, 2000];

const PAYMENT_METHODS = [
  { id: 'card',     label: 'Karta',    icon: '💳' },
  { id: 'cash',     label: 'Hotově',   icon: '💵' },
  { id: 'transfer', label: 'Převod',   icon: '🏦' },
  { id: 'voucher',  label: 'Voucher',  icon: '🎫' },
  { id: 'invoice',  label: 'Faktura',  icon: '📄' },
  { id: 'unpaid',   label: 'Nezaplaceno', icon: '⏸' },
];

function getSuggestions(total) {
  const result = [];
  for (const note of BANKNOTE_SUGGESTIONS) {
    let rounded = Math.ceil(total / note) * note;
    if (rounded >= total && !result.includes(rounded)) result.push(rounded);
    if (result.length >= 4) break;
  }
  if (!result.includes(Math.ceil(total))) result.unshift(Math.ceil(total));
  return result.slice(0, 5);
}

// Stav rozdělit platbu
function initSplit(total) {
  return { active: false, paid: [], remaining: total };
}

export function PaymentDialog({ open, onClose, total, documentNumberPreview, onConfirm }) {
  const [method, setMethod] = useState('card');
  const [tip, setTip] = useState('');
  const [tipMode, setTipMode] = useState('pct'); // 'pct' | 'custom'
  const [cashReceived, setCashReceived] = useState('');
  const [invoiceCustomer, setInvoiceCustomer] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState(createInvoiceDueDate());
  const [voucherLabel, setVoucherLabel] = useState('');
  const [note, setNote] = useState('');
  const [printReceipt, setPrintReceipt] = useState(true);
  const [email, setEmail] = useState('');
  const [terminalStatus, setTerminalStatus] = useState('idle');
  const [terminalMessage, setTerminalMessage] = useState('');
  const [terminalResult, setTerminalResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [split, setSplit] = useState(() => initSplit(total));
  const [splitStep, setSplitStep] = useState(''); // partial amount for current split leg
  const prefs = useMemo(() => loadDevicePrefs(), [open]);

  useEffect(() => {
    if (!open) return;
    setMethod('card');
    setTip('');
    setTipMode('pct');
    setCashReceived('');
    setInvoiceCustomer('');
    setInvoiceDueDate(createInvoiceDueDate());
    setVoucherLabel('');
    setNote('');
    setEmail('');
    setPrintReceipt(Boolean(prefs.printerAutoPrint));
    setTerminalStatus('idle');
    setTerminalMessage('');
    setTerminalResult(null);
    setSubmitting(false);
    setSplit(initSplit(total));
    setSplitStep('');
  }, [open, prefs.printerAutoPrint, total]);

  const tipAmount = useMemo(() => {
    if (!tip) return 0;
    if (tipMode === 'pct') return Math.round(total * Number(tip) / 100 * 100) / 100;
    return Number(tip) || 0;
  }, [tip, tipMode, total]);

  const totalWithTip = total + tipAmount;

  const change = useMemo(() => {
    const r = Number(cashReceived) || 0;
    return Math.max(0, r - (split.active ? split.remaining : totalWithTip));
  }, [cashReceived, totalWithTip, split]);

  const dotypayReady = method === 'card' && (prefs.terminalMode === 'dotypay-sim' || prefs.terminalMode === 'dotypay-live');

  const disableConfirm =
    submitting ||
    (method === 'cash' && !split.active && (Number(cashReceived) || 0) < totalWithTip) ||
    (method === 'cash' && split.active && (Number(cashReceived) || 0) < split.remaining) ||
    (method === 'invoice' && !invoiceCustomer.trim()) ||
    (method === 'voucher' && !voucherLabel.trim());

  // Rozdělit platbu – přidat splátku
  const addSplitLeg = () => {
    const amount = Number(splitStep);
    if (!amount || amount <= 0 || amount > split.remaining) return;
    const newPaid = [...split.paid, { method, amount: parseFloat(amount.toFixed(2)) }];
    const newRemaining = parseFloat((split.remaining - amount).toFixed(2));
    setSplit({ active: true, paid: newPaid, remaining: newRemaining });
    setSplitStep('');
    if (newRemaining <= 0.005) {
      finalizeSplit(newPaid, 0);
    }
  };

  const finalizeSplit = (paid, remaining) => {
    onConfirm({
      paymentMethod: 'split',
      splitLegs: paid,
      total,
      tipAmount,
      cashReceived: 0,
      change: 0,
      invoiceCustomer: '',
      invoiceDueDate: '',
      voucherLabel: '',
      note,
      email,
      printReceipt,
      terminalResult: null,
      unpaid: false,
    });
  };

  const handleConfirm = async () => {
    if (split.active && split.remaining > 0.005) {
      addSplitLeg();
      return;
    }
    setSubmitting(true);
    let nextTerminalResult = null;

    try {
      if (method === 'unpaid') {
        onConfirm({
          paymentMethod: 'unpaid',
          total,
          tipAmount,
          cashReceived: 0,
          change: 0,
          invoiceCustomer: '',
          invoiceDueDate: '',
          voucherLabel: '',
          note,
          email,
          printReceipt: false,
          terminalResult: null,
          unpaid: true,
        });
        return;
      }

      if (dotypayReady) {
        setTerminalStatus('processing');
        setTerminalMessage('Odesílám částku na Dotypay terminál…');
        nextTerminalResult = await runDotypayPayment({ amount: totalWithTip, documentNumber: documentNumberPreview });
        setTerminalResult(nextTerminalResult);
        setTerminalStatus(nextTerminalResult.status);
        setTerminalMessage(nextTerminalResult.message || 'Terminál vrátil výsledek.');
        if (nextTerminalResult.status !== 'approved') {
          setSubmitting(false);
          return;
        }
      } else if (method === 'card') {
        addDeviceLog('dotypay', 'Karetní platba bez Dotypay integrace.', { documentNumber: documentNumberPreview });
      }

      await Promise.resolve(onConfirm({
        paymentMethod: method,
        total,
        tipAmount,
        cashReceived: method === 'cash' ? Number(cashReceived) || 0 : 0,
        change: method === 'cash' ? change : 0,
        invoiceCustomer,
        invoiceDueDate,
        voucherLabel,
        note,
        email,
        printReceipt,
        terminalResult: nextTerminalResult,
        unpaid: false,
      }));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const currentRemaining = split.active ? split.remaining : totalWithTip;
  const TIP_PRESETS = [10, 15, 20];

  return (
    <div className="modal-backdrop">
      <div className="modal large-modal payment-modal">
        <div className="modal-header">
          <div>
            <h3>Platba</h3>
            <p className="muted">
              {formatCurrency(total)}{tipAmount > 0 ? ` + spropitné ${formatCurrency(tipAmount)} = ${formatCurrency(totalWithTip)}` : ''} · {documentNumberPreview}
            </p>
          </div>
          <button className="ghost-button" onClick={onClose} disabled={submitting}>✕</button>
        </div>

        <div className="stack">
          {/* ── Platební metody – velká tlačítka ── */}
          <div className="payment-method-grid">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`payment-method-btn ${method === m.id ? 'active' : ''}`}
                onClick={() => { setMethod(m.id); setSplit(initSplit(total)); setSplitStep(''); }}
                disabled={submitting}
              >
                <span className="pay-icon">{m.icon}</span>
                <span className="pay-label">{m.label}</span>
              </button>
            ))}
          </div>

          {/* ── Spropitné ── */}
          {method !== 'unpaid' && method !== 'invoice' && (
            <div className="inner-card stack compact">
              <div className="section-title-row">
                <strong>Spropitné</strong>
                <div className="toggle-row">
                  <button type="button" className={`toggle-pill compact-pill ${tipMode === 'pct' ? 'active' : ''}`} onClick={() => setTipMode('pct')}>%</button>
                  <button type="button" className={`toggle-pill compact-pill ${tipMode === 'custom' ? 'active' : ''}`} onClick={() => setTipMode('custom')}>Kč</button>
                  {tip ? <button type="button" className="ghost-button small-btn" onClick={() => setTip('')}>Zrušit</button> : null}
                </div>
              </div>
              <div className="tip-row">
                {TIP_PRESETS.map((pct) => (
                  <button key={pct} type="button"
                    className={`toggle-pill ${tipMode === 'pct' && tip === String(pct) ? 'active' : ''}`}
                    onClick={() => { setTipMode('pct'); setTip(String(pct)); }}
                  >{pct} %</button>
                ))}
                <input
                  className="tip-input"
                  type="number"
                  min="0"
                  step={tipMode === 'pct' ? '1' : '0.5'}
                  placeholder={tipMode === 'pct' ? 'Vlastní %' : 'Vlastní Kč'}
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                />
                {tipAmount > 0 && <span className="badge accent-badge">+{formatCurrency(tipAmount)}</span>}
              </div>
            </div>
          )}

          {/* ── Hotovost ── */}
          {method === 'cash' && (
            <div className="inner-card stack compact">
              <strong>Přijatá částka</strong>
              <div className="banknote-suggestions">
                {getSuggestions(currentRemaining).map((val) => (
                  <button key={val} type="button" className={`banknote-btn ${Number(cashReceived) === val ? 'active' : ''}`}
                    onClick={() => setCashReceived(String(val))}>
                    {formatCurrency(val)}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  Zadáno zákazníkem
                  <input type="number" min={currentRemaining} step="0.5" value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)} autoFocus />
                </label>
                <div className="summary-box summary-box-inline" style={{ alignSelf: 'flex-end' }}>
                  Vrátit: <strong className={change > 0 ? 'success-text' : ''}>{formatCurrency(change)}</strong>
                </div>
              </div>
            </div>
          )}

          {/* ── Karta / terminál ── */}
          {method === 'card' && (
            <div className="inner-card stack compact">
              <div className="section-title-row">
                <strong>Terminál</strong>
                <span className={`badge ${terminalStatus === 'approved' ? 'accent-badge' : terminalStatus === 'processing' ? 'warning-badge' : terminalStatus === 'idle' ? '' : 'danger-badge'}`}>
                  {prefs.terminalMode === 'dotypay-live' ? 'Dotypay LIVE' : prefs.terminalMode === 'dotypay-sim' ? 'Dotypay simulace' : 'Ruční'}
                </span>
              </div>
              <div className="list-row"><span>Zařízení</span><strong>{prefs.terminalLabel || 'Bez názvu'}</strong></div>
              {prefs.terminalMode === 'dotypay-live' && <div className="list-row"><span>IP</span><strong>{prefs.terminalHost || '—'}</strong></div>}
              {prefs.debugEnabled && prefs.terminalMode === 'dotypay-sim' ? (
                <div className="debug-inline-box">
                  <p className="muted no-margin">Debug scénář: <strong>{prefs.terminalScenario}</strong></p>
                </div>
              ) : null}
              {terminalMessage ? (
                <p className={`terminal-message ${terminalStatus === 'approved' ? 'success-text' : terminalStatus === 'processing' ? 'warning-text' : terminalStatus === 'idle' ? '' : 'danger-text'}`}>
                  {terminalMessage}
                </p>
              ) : null}
            </div>
          )}

          {/* ── Převod / QR ── */}
          {method === 'transfer' && (
            <div className="inner-card stack compact">
              <strong>Platba převodem</strong>
              <p className="muted">Zákazník zaplatí QR kódem nebo bankovním převodem. Účet označíme jako zaplaceno po ověření platby.</p>
              <div className="summary-box summary-box-inline">
                K úhradě: <strong>{formatCurrency(totalWithTip)}</strong>
              </div>
            </div>
          )}

          {/* ── Faktura ── */}
          {method === 'invoice' && (
            <div className="form-grid">
              <label>Odběratel / firma
                <input value={invoiceCustomer} onChange={(e) => setInvoiceCustomer(e.target.value)} placeholder="Název firmy nebo jméno" />
              </label>
              <label>Splatnost
                <input type="date" value={invoiceDueDate} onChange={(e) => setInvoiceDueDate(e.target.value)} />
              </label>
            </div>
          )}

          {/* ── Voucher ── */}
          {method === 'voucher' && (
            <div className="form-grid">
              <label>Označení voucheru
                <input value={voucherLabel} onChange={(e) => setVoucherLabel(e.target.value)} placeholder="Dárkový voucher / Sodexo…" />
              </label>
            </div>
          )}

          {/* ── Nezaplaceno ── */}
          {method === 'unpaid' && (
            <div className="inner-card">
              <p className="muted">Účet bude uzavřen bez platby a označen jako <strong>nezaplaceno</strong>. Upozornění při uzávěrce.</p>
            </div>
          )}

          {/* ── Rozdělit platbu ── */}
          {method !== 'unpaid' && (
            <div className="inner-card stack compact">
              <div className="section-title-row">
                <strong>Rozdělit platbu</strong>
                {!split.active && (
                  <button type="button" className="ghost-button small-btn"
                    onClick={() => setSplit({ active: true, paid: [], remaining: totalWithTip })}>
                    Aktivovat
                  </button>
                )}
                {split.active && <button type="button" className="ghost-button small-btn danger-outline"
                  onClick={() => { setSplit(initSplit(totalWithTip)); setSplitStep(''); }}>Zrušit</button>}
              </div>
              {split.active && (
                <div className="stack compact">
                  {split.paid.map((leg, i) => (
                    <div key={i} className="list-row">
                      <span>{PAYMENT_METHODS.find(m => m.id === leg.method)?.label ?? leg.method}</span>
                      <strong className="success-text">{formatCurrency(leg.amount)}</strong>
                    </div>
                  ))}
                  <div className="list-row">
                    <span>Zbývá</span>
                    <strong className={split.remaining > 0 ? 'warning-text' : 'success-text'}>{formatCurrency(split.remaining)}</strong>
                  </div>
                  {split.remaining > 0.005 && (
                    <div className="form-grid compact-grid">
                      <label>Zaplatit nyní ({PAYMENT_METHODS.find(m=>m.id===method)?.label})
                        <input type="number" min="0" max={split.remaining} step="0.5"
                          value={splitStep} onChange={(e) => setSplitStep(e.target.value)}
                          placeholder={formatCurrency(split.remaining)} />
                      </label>
                      <button type="button" className="ghost-button" style={{alignSelf:'flex-end'}} onClick={addSplitLeg}>
                        Přidat splátku
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Poznámka + e-mail + tisk ── */}
          <label>Poznámka k dokladu
            <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="volitelné" />
          </label>
          <div className="form-grid compact-grid">
            <label>E-mail zákazníka (pro zaslání účtenky)
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="volitelné" />
            </label>
            <label className="checkbox-row" style={{alignSelf:'flex-end',paddingBottom:'4px'}}>
              <input type="checkbox" checked={printReceipt} onChange={(e) => setPrintReceipt(e.target.checked)} />
              Tisknout účtenku
            </label>
          </div>

          <div className="form-actions">
            <button className="ghost-button" onClick={onClose} disabled={submitting}>Zpět</button>
            <button className="primary-button" onClick={handleConfirm} disabled={disableConfirm}>
              {submitting ? 'Zpracovávám…' : method === 'unpaid' ? 'Označit nezaplaceno' : dotypayReady ? `Odeslat na terminál · ${formatCurrency(totalWithTip)}` : `Potvrdit · ${formatCurrency(totalWithTip)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

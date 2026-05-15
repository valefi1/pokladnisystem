import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatDateTime, formatQuantity } from '../lib/format';
import { getQuantityStep, isWeightUnit } from '../lib/productUnits';
import { normalizeText } from '../lib/posStore';

function toLocalInputValue(value) {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function createEmptyDraft() {
  return {
    id: null,
    warehouse: 'Sklad Špajzka',
    supplierName: '',
    documentNumber: '',
    stockedAt: new Date().toISOString(),
    note: '',
    method: 'manual',
    updateSalePrices: false,
    items: [],
    rawOcrText: '',
    ocrWarnings: [],
    ocrSourceName: '',
    ocrConfidence: null,
  };
}

export function ReceivingPage({
  products,
  suppliers,
  receipts,
  draft,
  onSaveDraft,
  onClearDraft,
  onCompleteReceipt,
  onAddSupplier,
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState(() => draft || createEmptyDraft());
  const [search, setSearch] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [message, setMessage] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const invoiceInputRef = useRef(null);

  useEffect(() => {
    setForm(draft || createEmptyDraft());
  }, [draft]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onSaveDraft(form);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [form, onSaveDraft]);

  const filteredProducts = useMemo(() => {
    const needle = normalizeText(search);
    if (!needle) return [];
    return products
      .filter((product) => !product.hidden)
      .filter((product) => normalizeText(`${product.name} ${product.barcode} ${product.plu}`).includes(needle))
      .filter((product) => !form.items.some((item) => item.productId === product.id))
      .slice(0, 12);
  }, [form.items, products, search]);

  const totalCost = form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.purchasePrice) || 0), 0);
  const totalQuantity = form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const addItem = (product) => {
    setForm((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          productId: product.id,
          productName: product.name,
          category: product.category,
          unit: product.unit,
          currentStock: product.stock,
          purchasePrice: product.costPrice || 0,
          salePrice: product.price || 0,
          quantity: 0,
        },
      ],
    }));
    setSearch('');
    setCurrentStep(3);
  };

  const updateItem = (productId, patch) => {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => (item.productId === productId ? { ...item, ...patch } : item)),
    }));
  };

  const removeItem = (productId) => {
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.productId !== productId),
    }));
  };

  const saveSupplier = () => {
    const name = newSupplierName.trim();
    if (!name) return;
    onAddSupplier({ name });
    setForm((current) => ({ ...current, supplierName: current.supplierName || name }));
    setNewSupplierName('');
    setMessage(`Dodavatel „${name}“ přidán do seznamu.`);
  };

  const saveDraftNow = () => {
    onSaveDraft(form);
    setMessage('Koncept naskladnění uložen do prohlížeče.');
  };

  const resetDraft = () => {
    const next = createEmptyDraft();
    setForm(next);
    onClearDraft();
    setMessage('Rozpracované naskladnění bylo vymazáno.');
    setCurrentStep(1);
    setOcrStatus('');
    setOcrProgress(0);
  };

  const completeReceipt = () => {
    const validItems = form.items.filter((item) => (Number(item.quantity) || 0) > 0);
    if (!validItems.length) {
      setMessage('Nejdřív doplň aspoň jednu položku s množstvím větším než 0.');
      setCurrentStep(3);
      return;
    }
    const payload = {
      ...form,
      stockedAt: new Date(toLocalInputValue(form.stockedAt)).toISOString(),
      items: validItems,
    };
    onCompleteReceipt(payload);
    setForm(createEmptyDraft());
    setCurrentStep(1);
    setMessage(`Naskladnění bylo dokončeno. Položek: ${validItems.length}.`);
    setOcrStatus('');
    setOcrProgress(0);
  };

  const handleInvoiceDocument = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setOcrBusy(true);
    setOcrProgress(0);
    setOcrStatus(`Zpracovávám ${file.name}…`);
    setMessage('');

    try {
      const { recognizeInvoiceDocument } = await import('../lib/invoiceOcr');
      const result = await recognizeInvoiceDocument(file, { products, suppliers }, (progress) => {
        if (typeof progress === 'number') {
          setOcrProgress(progress);
          return;
        }
        if (typeof progress?.percent === 'number') setOcrProgress(progress.percent);
        if (progress?.message) setOcrStatus(progress.message);
      });
      setForm((current) => ({
        ...current,
        method: 'invoice-photo',
        supplierName: result.supplierName || current.supplierName,
        documentNumber: result.documentNumber || current.documentNumber,
        stockedAt: result.stockedAt || current.stockedAt,
        items: result.items.length ? result.items : current.items,
        rawOcrText: (result.rawText || '').slice(0, 5000),
        ocrWarnings: result.warnings || [],
        ocrSourceName: file.name,
        ocrConfidence: result.confidence,
      }));
      if (result.supplierName) {
        onAddSupplier({ name: result.supplierName });
      }
      setOcrStatus(`${result.sourceType === 'pdf-text' ? 'PDF načteno přímo' : result.sourceType === 'pdf-ocr' ? 'PDF OCR hotovo' : 'OCR hotovo'}${result.confidence ? ` · přesnost ${Math.round(result.confidence)} %` : ''}`);
      setMessage(result.items.length ? `Z dokladu jsem předvyplnil ${result.items.length} položek. Vše prosím zkontroluj před dokončením.` : 'Doklad jsem přečetl, ale položky je potřeba doplnit ručně.');
      setCurrentStep(3);
    } catch (error) {
      console.error(error);
      setMessage('OCR se nepodařilo dokončit. Zkus čitelnější PDF nebo ostřejší fotku, případně přidej položky ručně.');
      setOcrStatus('OCR selhalo');
    } finally {
      setOcrBusy(false);
      event.target.value = '';
    }
  };

  const stepItems = [
    ['Úvod', 1],
    ['Možnosti naskladnění', 2],
    ['Položky', 3],
    ['Souhrn', 4],
  ];

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <h1>Naskladnění</h1>
          <p className="muted">Ruční příjem ve stylu DOtykačky: datum, dodavatel, položky, souhrn a nově i fotka nebo PDF faktury s automatickým předvyplněním údajů.</p>
        </div>
        <div className="inline-actions">
          <button className="ghost-button" onClick={saveDraftNow}>Uložit koncept</button>
          <button className="ghost-button" onClick={resetDraft}>Nové naskladnění</button>
        </div>
      </section>

      {message ? <div className="card info-card">{message}</div> : null}

      <section className="card">
        <div className="stepper-row">
          {stepItems.map(([label, step]) => (
            <button key={label} className={`step-pill ${currentStep === step ? 'active' : currentStep > step ? 'done' : ''}`} onClick={() => setCurrentStep(step)}>
              <span>{step}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="split-grid receiving-grid">
        <div className="stack gap-lg">
          {currentStep === 1 ? (
            <section className="card">
              <div className="section-title-row">
                <h2>Základní údaje</h2>
                <span className="badge accent-badge">Krok 1</span>
              </div>
              <div className="form-grid">
                <label>
                  Sklad
                  <input value={form.warehouse} onChange={(e) => setForm((current) => ({ ...current, warehouse: e.target.value }))} />
                </label>
                <label>
                  Datum a čas naskladnění
                  <input type="datetime-local" value={toLocalInputValue(form.stockedAt)} onChange={(e) => setForm((current) => ({ ...current, stockedAt: new Date(e.target.value).toISOString() }))} />
                </label>
                <label>
                  Dodavatel
                  <input list="supplier-list" value={form.supplierName} onChange={(e) => setForm((current) => ({ ...current, supplierName: e.target.value }))} placeholder="Vyber nebo napiš dodavatele" />
                  <datalist id="supplier-list">
                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                  </datalist>
                </label>
                <label>
                  Číslo dodacího listu / faktury
                  <input value={form.documentNumber} onChange={(e) => setForm((current) => ({ ...current, documentNumber: e.target.value }))} placeholder="např. DL20260410" />
                </label>
                <label className="full-row">
                  Poznámka
                  <textarea rows="3" value={form.note} onChange={(e) => setForm((current) => ({ ...current, note: e.target.value }))} placeholder="volitelné" />
                </label>
                <label className="checkbox-row full-row">
                  <input type="checkbox" checked={form.updateSalePrices} onChange={(e) => setForm((current) => ({ ...current, updateSalePrices: e.target.checked }))} />
                  V posledním kroku umožnit upravit i prodejní ceny
                </label>
              </div>
              <div className="form-actions top-gap">
                <button className="primary-button" onClick={() => setCurrentStep(2)}>Pokračovat</button>
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="card">
              <div className="section-title-row">
                <h2>Možnosti naskladnění</h2>
                <span className="badge accent-badge">Krok 2</span>
              </div>
              <input ref={invoiceInputRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden-file-input" onChange={handleInvoiceDocument} />
              <div className="method-grid method-grid-2">
                <button className={`method-card ${form.method === 'manual' ? 'active' : ''}`} onClick={() => setForm((current) => ({ ...current, method: 'manual' }))}>
                  <strong>Ruční naskladnění</strong>
                  <p className="muted">Vyhledáš produkty, zadáš množství a nákupní cenu, pak vše potvrdíš v souhrnu.</p>
                </button>
                <button className={`method-card ${form.method === 'invoice-photo' ? 'active' : ''}`} onClick={() => setForm((current) => ({ ...current, method: 'invoice-photo' }))}>
                  <strong>Fotka nebo PDF faktury / dodacího listu</strong>
                  <p className="muted">Nahraješ fotku nebo PDF dokladu, OCR se pokusí doplnit dodavatele, číslo dokladu, datum a položky. Pak vše ručně zkontroluješ.</p>
                </button>
              </div>

              {form.method === 'invoice-photo' ? (
                <div className="card inner-card top-gap stack compact">
                  <div className="list-row">
                    <div>
                      <strong>OCR z fotky nebo PDF</strong>
                      <p className="muted">Nejlépe funguje PDF s textovou vrstvou nebo ostrá fotka shora s viditelným názvem dodavatele a položkami.</p>
                    </div>
                    <button className="primary-button" onClick={() => invoiceInputRef.current?.click()} disabled={ocrBusy}>
                      {ocrBusy ? 'Zpracovávám…' : 'Vyfotit / nahrát PDF'}
                    </button>
                  </div>
                  {ocrBusy ? (
                    <div className="stack compact">
                      <div className="progress-bar"><span style={{ width: `${ocrProgress}%` }} /></div>
                      <p className="muted">{ocrStatus || 'Probíhá OCR…'} {ocrProgress ? `${ocrProgress} %` : ''}</p>
                    </div>
                  ) : null}
                  {!ocrBusy && ocrStatus ? <p className="muted">{ocrStatus}</p> : null}
                </div>
              ) : null}

              <div className="form-actions top-gap">
                <button className="ghost-button" onClick={() => setCurrentStep(1)}>Zpět</button>
                <button className="primary-button" onClick={() => setCurrentStep(3)}>Pokračovat</button>
              </div>
            </section>
          ) : null}

          {currentStep === 3 ? (
            <section className="card">
              <div className="section-title-row">
                <h2>Položky naskladnění</h2>
                <span className="badge accent-badge">Krok 3</span>
              </div>
              {form.ocrSourceName ? (
                <div className="card inner-card ocr-summary-card">
                  <div className="list-row align-start">
                    <div>
                      <strong>Načteno z fotky: {form.ocrSourceName}</strong>
                      <p className="muted">Dodavatel: {form.supplierName || '—'} · Doklad: {form.documentNumber || '—'} · Přesnost: {form.ocrConfidence ? `${Math.round(form.ocrConfidence)} %` : '—'}</p>
                    </div>
                    <button className="ghost-button" onClick={() => invoiceInputRef.current?.click()} disabled={ocrBusy}>Nahrát znovu</button>
                  </div>
                  {form.ocrWarnings?.length ? (
                    <div className="stack compact top-gap">
                      {form.ocrWarnings.map((warning) => <p key={warning} className="muted">• {warning}</p>)}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="toolbar space-between toolbar-gap">
                <input className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vyhledat produkt podle názvu, EAN nebo PLU" />
                <span className="muted">{form.items.length} položek v naskladnění</span>
              </div>
              {filteredProducts.length ? (
                <div className="card inner-card suggestion-box">
                  <div className="stack compact">
                    {filteredProducts.map((product) => (
                      <div key={product.id} className="list-row">
                        <div>
                          <strong>{product.name}</strong>
                          <p className="muted">{product.category} · skladem {formatQuantity(product.stock)} {product.unit} · {isWeightUnit(product.unit) ? 'vážená položka' : 'kusová položka'}</p>
                        </div>
                        <button className="ghost-button" onClick={() => addItem(product)}>Přidat</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Název</th>
                      <th>Množství</th>
                      <th>NC bez DPH</th>
                      <th>NC celkem</th>
                      <th>Aktuální sklad</th>
                      {form.updateSalePrices ? <th>Prodejní cena</th> : null}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.length === 0 ? (
                      <tr>
                        <td colSpan={form.updateSalePrices ? 7 : 6}>
                          <p className="muted">Začni vyhledáním produktu nahoře a přidej ho do naskladnění. U OCR varianty se sem načtou rozpoznané položky.</p>
                        </td>
                      </tr>
                    ) : null}
                    {form.items.map((item) => (
                      <tr key={item.productId}>
                        <td>
                          <strong>{item.productName}</strong>
                          <div className="table-subline">{item.category}</div>
                          {item.sourceLine ? <div className="table-subline muted">OCR: {item.sourceLine}</div> : null}
                          {item.matchConfidence ? (
                            <div className="table-subline muted">
                              Shoda: {item.matchConfidence} %{item.matchStrategy === 'similarity' ? ' · nejvyšší podobnost' : ' · přesná shoda'}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <input type="number" min="0" step={getQuantityStep(item.unit)} value={item.quantity} onChange={(e) => updateItem(item.productId, { quantity: Number(e.target.value) || 0 })} />
                        </td>
                        <td>
                          <input type="number" min="0" step="0.01" value={item.purchasePrice} onChange={(e) => updateItem(item.productId, { purchasePrice: Number(e.target.value) || 0 })} />
                        </td>
                        <td>{formatCurrency((Number(item.quantity) || 0) * (Number(item.purchasePrice) || 0))}</td>
                        <td>{formatQuantity(item.currentStock)} {item.unit}</td>
                        {form.updateSalePrices ? (
                          <td>
                            <input type="number" min="0" step="0.01" value={item.salePrice} onChange={(e) => updateItem(item.productId, { salePrice: Number(e.target.value) || 0 })} />
                          </td>
                        ) : null}
                        <td><button className="ghost-button" onClick={() => removeItem(item.productId)}>Odebrat</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions top-gap">
                <button className="ghost-button" onClick={() => setCurrentStep(2)}>Zpět</button>
                <button className="primary-button" onClick={() => setCurrentStep(4)}>Pokračovat</button>
              </div>
            </section>
          ) : null}

          {currentStep === 4 ? (
            <section className="card">
              <div className="section-title-row">
                <h2>Souhrn naskladnění</h2>
                <span className="badge accent-badge">Krok 4</span>
              </div>
              <div className="summary-grid">
                <div className="summary-box">
                  <span className="muted">Dodavatel</span>
                  <strong>{form.supplierName || 'Bez dodavatele'}</strong>
                </div>
                <div className="summary-box">
                  <span className="muted">Datum</span>
                  <strong>{formatDateTime(form.stockedAt)}</strong>
                </div>
                <div className="summary-box">
                  <span className="muted">Počet položek</span>
                  <strong>{form.items.length}</strong>
                </div>
                <div className="summary-box">
                  <span className="muted">Množství celkem</span>
                  <strong>{formatQuantity(totalQuantity)}</strong>
                </div>
              </div>
              <div className="summary-box top-gap">
                <div className="list-row">
                  <span>Nákupní hodnota</span>
                  <strong>{formatCurrency(totalCost)}</strong>
                </div>
                <div className="list-row">
                  <span>Doklad</span>
                  <strong>{form.documentNumber || 'bez čísla dokladu'}</strong>
                </div>
                <div className="list-row">
                  <span>Režim</span>
                  <strong>{form.method === 'invoice-photo' ? 'Fotka faktury / OCR' : 'Ruční naskladnění'}</strong>
                </div>
              </div>
              {form.rawOcrText ? (
                <details className="top-gap">
                  <summary>Zobrazit rozpoznaný text z faktury</summary>
                  <pre className="ocr-preview">{form.rawOcrText}</pre>
                </details>
              ) : null}
              <div className="form-actions top-gap">
                <button className="ghost-button" onClick={() => setCurrentStep(3)}>Zpět</button>
                <button className="primary-button" onClick={completeReceipt}>Dokončit naskladnění</button>
              </div>
            </section>
          ) : null}
        </div>

        <div className="stack gap-lg">
          <section className="card">
            <div className="section-title-row">
              <h2>Dodavatelé</h2>
              <span className="badge">{suppliers.length}</span>
            </div>
            <div className="stack compact">
              <div className="inline-actions compact-actions">
                <input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Přidat dodavatele ručně" />
                <button className="ghost-button" onClick={saveSupplier}>Přidat</button>
              </div>
              {suppliers.length === 0 ? <p className="muted">Seznam dodavatelů zatím není naplněný. Můžeš je zadávat ručně přímo sem nebo do pole dodavatele v naskladnění.</p> : null}
              {suppliers.slice(0, 12).map((supplier) => (
                <div key={supplier.id} className="list-row"><strong>{supplier.name}</strong></div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="section-title-row">
              <h2>Poslední naskladnění</h2>
              <span className="badge">{receipts.length}</span>
            </div>
            <div className="stack compact">
              {receipts.length === 0 ? <p className="muted">Zatím tu nejsou dokončená ruční naskladnění.</p> : null}
              {receipts.slice(0, 8).map((receipt) => (
                <div key={receipt.id} className="card inner-card">
                  <div className="list-row">
                    <div>
                      <strong>{receipt.supplierName || 'Bez dodavatele'}</strong>
                      <p className="muted">{formatDateTime(receipt.stockedAt)} · {receipt.documentNumber || 'bez dokladu'}</p>
                    </div>
                    <span>{formatCurrency(receipt.totalCost || 0)}</span>
                  </div>
                  <p className="muted no-margin">{receipt.items.length} položek · {formatQuantity(receipt.totalItems || 0)} celkem</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

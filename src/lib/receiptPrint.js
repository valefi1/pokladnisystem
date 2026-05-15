import { formatCurrency, formatDateTime, formatQuantity } from './format';
import { formatUnitLabel } from './productUnits';
import { addDeviceLog } from './deviceDebug';
import { loadDevicePrefs } from './devicePrefs';

const PAYMENT_LABELS = {
  card: 'Karta',
  cash: 'Hotově',
  invoice: 'Faktura',
  voucher: 'Voucher',
  transfer: 'Převod',
  split: 'Rozdělená platba',
  unpaid: 'Nezaplaceno',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLineItems(items = []) {
  return items
    .map((item) => {
      const qty = `${formatQuantity(item.quantity)} ${formatUnitLabel(item.unit || 'ks')}`;
      const lineTotal = formatCurrency((Number(item.price) || 0) * (Number(item.quantity) || 0));
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong><br />
            <small>${escapeHtml(qty)} × ${escapeHtml(formatCurrency(item.price))}</small>
          </td>
          <td style="text-align:right; white-space:nowrap;">${escapeHtml(lineTotal)}</td>
        </tr>
      `;
    })
    .join('');
}

function buildDocumentHtml(sale, prefs) {
  const isInvoice = sale.paymentMethod === 'invoice';
  const title = isInvoice ? 'FAKTURA / DODACÍ DOKLAD' : 'ÚČTENKA';
  const paymentLabel = PAYMENT_LABELS[sale.paymentMethod] || sale.paymentMethod;
  const invoiceDue = sale.invoiceDueDate ? formatDateTime(sale.invoiceDueDate) : '—';
  const customerName = sale.invoiceCustomer || sale.voucherLabel || '';
  const note = sale.note || '';
  const paperWidth = prefs.printerPaper === '58mm' ? 230 : 320;
  const terminalLine = sale.terminalProvider
    ? `<p class="muted">Terminál: ${escapeHtml(sale.terminalProvider)} · ${escapeHtml(sale.terminalStatus || '—')}</p>`
    : '';
  const terminalRef = sale.terminalReference ? `<p class="muted">Ref: ${escapeHtml(sale.terminalReference)}</p>` : '';
  const subtotal = Number(sale.subtotal ?? sale.total ?? 0);
  const tipAmount = Number(sale.tipAmount) || 0;
  const total = Number(sale.total) || subtotal + tipAmount;
  const splitRows = Array.isArray(sale.splitLegs) && sale.splitLegs.length
    ? sale.splitLegs.map((leg) => `<tr><td>${escapeHtml(PAYMENT_LABELS[leg.method] || leg.method)}</td><td class="text-right">${escapeHtml(formatCurrency(leg.amount || 0))}</td></tr>`).join('')
    : '';

  return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)} ${escapeHtml(sale.documentNumber || '')}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 10px; color: #111; }
      .receipt { max-width: ${paperWidth}px; margin: 0 auto; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { margin: 3px 0; }
      hr { border: 0; border-top: 1px dashed #888; margin: 10px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 5px 0; vertical-align: top; }
      .summary td { padding: 4px 0; }
      .text-right { text-align: right; }
      .muted { color: #555; }
      .totals { font-weight: 700; font-size: 18px; }
      .print-note { margin-top: 14px; font-size: 11px; color: #666; }
      @media print {
        body { padding: 0; }
        .print-note { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="receipt">
      <h1>${escapeHtml(title)}</h1>
      <p><strong>Nezávislá pokladna</strong></p>
      <p class="muted">Doklad: ${escapeHtml(sale.documentNumber || '—')}</p>
      <p class="muted">Datum: ${escapeHtml(formatDateTime(sale.createdAt))}</p>
      <p class="muted">Platba: ${escapeHtml(paymentLabel)}</p>
      ${terminalLine}
      ${terminalRef}
      ${customerName ? `<p class="muted">Odběratel / voucher: ${escapeHtml(customerName)}</p>` : ''}
      ${isInvoice ? `<p class="muted">Splatnost: ${escapeHtml(invoiceDue)}</p>` : ''}
      ${note ? `<p class="muted">Poznámka: ${escapeHtml(note)}</p>` : ''}
      <hr />
      <table>
        <tbody>
          ${renderLineItems(sale.items || [])}
        </tbody>
      </table>
      <hr />
      <table class="summary">
        <tbody>
          <tr>
            <td>Mezisoučet</td>
            <td class="text-right">${escapeHtml(formatCurrency(subtotal))}</td>
          </tr>
          ${tipAmount > 0 ? `<tr><td>Spropitné</td><td class="text-right">${escapeHtml(formatCurrency(tipAmount))}</td></tr>` : ''}
          <tr>
            <td>Celkem k úhradě</td>
            <td class="text-right totals">${escapeHtml(formatCurrency(total))}</td>
          </tr>
          ${splitRows}
          ${sale.paymentMethod === 'cash' ? `<tr><td>Přijato</td><td class="text-right">${escapeHtml(formatCurrency(sale.cashReceived || 0))}</td></tr>` : ''}
          ${sale.paymentMethod === 'cash' ? `<tr><td>Vráceno</td><td class="text-right">${escapeHtml(formatCurrency(sale.change || 0))}</td></tr>` : ''}
        </tbody>
      </table>
      <p class="print-note">Režim tisku: ${escapeHtml(printerModeLabel(prefs.printerMode))} · ${escapeHtml(prefs.printerPaper)}</p>
    </div>
    <script>
      window.onload = () => {
        setTimeout(() => {
          window.print();
        }, 150);
      };
    </script>
  </body>
</html>`;
}

function printerModeLabel(mode) {
  if (mode === 'browser-print') return 'Systémový dialog';
  if (mode === 'usb-bridge-prep') return 'USB bridge · příprava';
  if (mode === 'escpos-prep') return 'ESC/POS · příprava';
  return mode || 'Neznámý režim';
}

function openPrintWindow(html) {
  const printWindow = window.open('', '_blank', 'width=460,height=820');
  if (!printWindow) {
    window.alert('Pro tisk povol v prohlížeči otevření nového okna.');
    return false;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  return true;
}

export function printSaleDocument(sale) {
  const prefs = loadDevicePrefs();
  addDeviceLog('printer', 'Požadavek na tisk dokladu.', {
    documentNumber: sale.documentNumber,
    printerMode: prefs.printerMode,
    printerPaper: prefs.printerPaper,
    printerLabel: prefs.printerLabel,
    copies: prefs.printerCopies,
  });

  if (prefs.printerMode !== 'browser-print') {
    addDeviceLog('printer', 'Přímý USB / ESC-POS tisk zatím není aktivní. Otevírám systémový tisk.', {
      configuredMode: prefs.printerMode,
    }, 'warning');
  }

  const success = openPrintWindow(buildDocumentHtml(sale, prefs));
  if (success) {
    addDeviceLog('printer', 'Tiskové okno otevřené.', {
      documentNumber: sale.documentNumber,
    });
  }
}

export function printTestDocument() {
  const prefs = loadDevicePrefs();
  const success = openPrintWindow(buildDocumentHtml({
    createdAt: new Date().toISOString(),
    documentNumber: 'TEST-PRINTER',
    paymentMethod: 'cash',
    cashReceived: 100,
    change: 51,
    total: 49,
    items: [
      { name: 'Testovací položka', quantity: 1, unit: 'ks', price: 49 },
      { name: 'Kontrola šířky papíru', quantity: 1, unit: 'ks', price: 0 },
    ],
    note: 'Zkušební tisk zařízení',
  }, prefs));

  addDeviceLog('printer', success ? 'Spuštěn test tiskárny.' : 'Test tiskárny se nepodařilo otevřít.', {
    printerLabel: prefs.printerLabel,
    printerPaper: prefs.printerPaper,
    printerMode: prefs.printerMode,
  }, success ? 'info' : 'warning');
}

export function paymentMethodLabel(method) {
  return PAYMENT_LABELS[method] || method || 'Jiná platba';
}

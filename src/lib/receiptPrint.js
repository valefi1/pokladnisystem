import { formatCurrency, formatDateTime, formatQuantity } from './format';
import { formatUnitLabel } from './productUnits';
import { addDeviceLog } from './deviceDebug';
import { loadDevicePrefs } from './devicePrefs';
import { buildVatBreakdown, netFromGross } from './vat';

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
      const gross = (Number(item.lineGross) || ((Number(item.price) || 0) * (Number(item.quantity) || 0)));
      const discount = Number(item.lineDiscount) || 0;
      const lineTotal = Number(item.lineTotal) || Math.max(0, gross - discount);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong><br />
            <small>${escapeHtml(qty)} × ${escapeHtml(formatCurrency(item.priceWithVat ?? item.price))} s DPH</small>
            ${discount > 0 ? `<br /><small>Sleva položky: -${escapeHtml(formatCurrency(discount))}</small>` : ''}
          </td>
          <td style="text-align:right; white-space:nowrap;">${escapeHtml(formatCurrency(lineTotal))}</td>
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
  const grossSubtotal = Number(sale.grossSubtotal ?? sale.subtotal ?? sale.total ?? 0);
  const itemDiscountTotal = Number(sale.itemDiscountTotal) || 0;
  const saleDiscountAmount = Number(sale.saleDiscountAmount) || 0;
  const subtotal = Number(sale.subtotal ?? Math.max(0, grossSubtotal - itemDiscountTotal - saleDiscountAmount));
  const vatBreakdown = Array.isArray(sale.vatBreakdown) && sale.vatBreakdown.length ? sale.vatBreakdown : buildVatBreakdown(sale.items || [], saleDiscountAmount);
  const subtotalWithoutVat = Number(sale.subtotalWithoutVat ?? vatBreakdown.reduce((sum, row) => sum + (Number(row.base) || 0), 0));
  const vatTotal = Number(sale.vatTotal ?? vatBreakdown.reduce((sum, row) => sum + (Number(row.vat) || 0), 0));
  const vatRows = vatBreakdown.map((row) => `<tr><td>DPH ${escapeHtml(row.vatRate)} %</td><td class="text-right">${escapeHtml(formatCurrency(row.vat || 0))}</td></tr>`).join('');
  const tipAmount = Number(sale.tipAmount) || 0;
  const roundingAmount = Number(sale.roundingAmount) || 0;
  const total = Number(sale.total) || subtotal + tipAmount + roundingAmount;
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
            <td>Mezisoučet před slevami</td>
            <td class="text-right">${escapeHtml(formatCurrency(grossSubtotal))}</td>
          </tr>
          ${itemDiscountTotal > 0 ? `<tr><td>Slevy položek</td><td class="text-right">-${escapeHtml(formatCurrency(itemDiscountTotal))}</td></tr>` : ''}
          ${saleDiscountAmount > 0 ? `<tr><td>Sleva na nákup</td><td class="text-right">-${escapeHtml(formatCurrency(saleDiscountAmount))}</td></tr>` : ''}
          <tr>
            <td>Základ bez DPH</td>
            <td class="text-right">${escapeHtml(formatCurrency(subtotalWithoutVat))}</td>
          </tr>
          ${vatRows}
          <tr>
            <td>Mezisoučet s DPH</td>
            <td class="text-right">${escapeHtml(formatCurrency(subtotal))}</td>
          </tr>
          ${tipAmount > 0 ? `<tr><td>Spropitné</td><td class="text-right">${escapeHtml(formatCurrency(tipAmount))}</td></tr>` : ''}
          ${roundingAmount !== 0 ? `<tr><td>Zaokrouhlení hotově</td><td class="text-right">${escapeHtml(formatCurrency(roundingAmount))}</td></tr>` : ''}
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
      { name: 'Testovací položka', quantity: 1, unit: 'ks', price: 49, priceWithVat: 49, priceWithoutVat: netFromGross(49, 12), vatRate: 12 },
      { name: 'Kontrola šířky papíru', quantity: 1, unit: 'ks', price: 0, priceWithVat: 0, priceWithoutVat: 0, vatRate: 12 },
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

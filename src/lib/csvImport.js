import { inferUnitFromQuantity } from './productUnits';

const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function parseNumber(value) {
  if (value == null || value === '') return 0;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ';' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((cell) => cell.trim());
}

function parseDotyCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);

  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

export function parseStockSnapshotCsv(text) {
  const rows = parseDotyCsv(text);
  return rows.map((row) => {
    const stock = parseNumber(row['Množství na skladu']);
    return ({
    id: uid('p'),
    name: row['Produkt'] || 'Bez názvu',
    category: row['Kategorie'] || 'Nezařazeno',
    price: parseNumber(row['Prodejní cena bez DPH']),
    costPrice: parseNumber(row['Jednotková NC bez DPH']),
    stock,
    unit: inferUnitFromQuantity(stock),
    barcode: row.EAN || '',
    plu: row.PLU || '',
    hidden: false,
    sourceStockName: row['Sklad'] || '',
    importedAt: new Date().toISOString(),
  });
  });
}

export function parseStockMovementHistoryCsv(text) {
  const rows = parseDotyCsv(text);
  return rows
    .map((row) => {
      const rawType = row['Typ transakce'] || '';
      let type = null;
      if (/prodej/i.test(rawType)) type = 'sale';
      if (/odpis/i.test(rawType)) type = 'writeoff';
      if (!type) return null;

      return {
        id: uid('h'),
        productName: row['Produkt'] || 'Bez názvu',
        category: row['Kategorie'] || 'Nezařazeno',
        barcode: row.EAN || '',
        plu: row.PLU || '',
        type,
        quantity: Math.abs(parseNumber(row['Množství'])),
        createdAt: row['Datum vytvoření'] || new Date().toISOString(),
        source: 'csv',
      };
    })
    .filter(Boolean)
    .filter((row) => row.quantity > 0);
}

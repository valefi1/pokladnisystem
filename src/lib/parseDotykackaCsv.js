/**
 * Parsuje CSV export z Dotykačky (vzdálená správa → Produkty → Export)
 * Formát: categoryName;productId;name;vat;priceWithVAT
 * Kódování: Windows-1250
 */

function parseDecimal(str) {
  // "350,00" → 350, "1 290,00" → 1290
  return parseFloat(String(str).replace(/\s/g,'').replace(',','.')) || 0;
}

export function parseDotykackaCsv(fileContent) {
  const lines = fileContent.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV je prázdné nebo má nesprávný formát.');

  const header = lines[0].split(';').map(h => h.trim().replace(/^\uFEFF/,''));
  const required = ['categoryName','productId','name','vat','priceWithVAT'];
  for (const col of required) {
    if (!header.includes(col)) throw new Error(`Chybí sloupec "${col}". Zkontroluj formát exportu z Dotykačky.`);
  }

  const idx = h => header.indexOf(h);
  const products = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 3) continue;

    const name = (cols[idx('name')] || '').trim();
    if (!name) continue;

    const vatPct = parseDecimal(cols[idx('vat')]);
    const priceWithVat = parseDecimal(cols[idx('priceWithVAT')]);

    // Cena bez DPH → cena s DPH (Dotykačka exportuje cenu s DPH)
    // Pokladna pracuje s cenou s DPH — uložíme přímo
    const vatRate = vatPct === 21 ? 21 : vatPct === 0 ? 0 : 12;

    products.push({
      dotykackaId: (cols[idx('productId')] || '').trim(),
      name,
      category: (cols[idx('categoryName')] || '').trim() || 'Nezařazeno',
      price: priceWithVat,
      vatRate,
    });
  }

  return products;
}

/**
 * Přečte File jako text s kódováním windows-1250 (nebo UTF-8 s BOM)
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Nepodařilo se přečíst soubor.'));
    // Dotykačka exportuje windows-1250
    reader.readAsText(file, 'windows-1250');
  });
}

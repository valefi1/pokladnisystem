import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getDefaultSaleQuantity, getQuantityStep, isWeightUnit, normalizeCartQuantity } from './productUnits';
import { normalizeText } from './posStore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ROW_Y_TOLERANCE = 3;
const MAX_PDF_TEXT_PAGES = 5;
const MAX_PDF_OCR_PAGES = 3;

function emitProgress(onProgress, payload) {
  if (typeof onProgress === 'function') onProgress(payload);
}

function parseDateFromText(text) {
  const match = text.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, d, m, y, hh = '08', mm = '00'] = match;
  const year = y.length === 2 ? `20${y}` : y;
  const date = new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDocumentNumber(lines) {
  const patterns = [
    /(faktura|doklad|invoice|cislo|číslo)[^A-Z0-9]{0,8}([A-Z0-9][A-Z0-9\-\/.]{3,})/i,
    /(vs|variabilni\s+symbol|variabilní\s+symbol)[^A-Z0-9]{0,8}([A-Z0-9][A-Z0-9\-\/.]{3,})/i,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[2]) return match[2].trim();
    }
  }
  return '';
}

function guessSupplier(text, lines, suppliers) {
  const normalized = normalizeText(text);
  let bestSupplier = null;
  let bestScore = 0;

  suppliers.forEach((supplier) => {
    const name = normalizeText(supplier.name);
    let score = 0;
    if (name && normalized.includes(name)) score += 10;
    const vatId = normalizeText(supplier.vatId || '');
    if (vatId && normalized.includes(vatId)) score += 9;
    const vatNo = normalizeText(supplier.vatNo || '');
    if (vatNo && normalized.includes(vatNo)) score += 8;
    const address = normalizeText(supplier.address || '');
    if (address && address.length > 6 && normalized.includes(address)) score += 4;
    if (score > bestScore) {
      bestScore = score;
      bestSupplier = supplier;
    }
  });

  if (bestSupplier) return bestSupplier.name;

  const fallback = lines.find((line) => {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine || normalizedLine.length < 4) return false;
    if (/faktura|invoice|danovy|daňový|ico|ičo|dic|dič|telefon|tel\.|mobil|www\.|http|mail|e-mail/.test(normalizedLine)) return false;
    if (/\d{3,}/.test(normalizedLine) && normalizedLine.length < 10) return false;
    return true;
  });
  return fallback || '';
}

function parseNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/(?<=\d),(?=\d{3}(\D|$))/g, '')
    .replace(/,/g, '.')
    .replace(/[A-Za-zčČěĚšŠřŘžŽýÝáÁíÍéÉúÚůŮ]/g, '')
    .replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

const MATCH_STOPWORDS = new Set([
  'bio', 'cz', 'ks', 'kus', 'kg', 'g', 'l', 'ml', 'bal', 'baleni', 'baleni', 'balik', 'balicek', 'balíček',
  'mj', 'ean', 'plu', 'dph', 'cena', 'celkem', 'sleva', 'sazba', 'zaklad', 'základ', 'netto', 'brutto',
  'radek', 'řádek', 'obsah', 'sumar', 'sumář', 'doplnit', 'produkt', 'produkty', 'dodavka', 'dodávka',
  'kc', 'trida', 'třída', 'tridy', 'třídy', 'tridy', 'cerstve', 'čerstvé', 'cerstvy', 'čerstvý', 'cerstva', 'čerstvá',
  'jakost', 'extra', 'super', 'premium', 'akcni', 'akční', 'akc', 'jakosti', 'a'
]);

function normalizeItemText(value) {
  return normalizeText(value)
    .replace(/\b\d+[.,]?\d*\s*(kg|g|ks|kus|bal|baleni|balení|l|ml)\b/g, ' ')
    .replace(/\b(cena|celkem|dph|sleva|mnozstvi|množství|mj|ean|sazba|zaklad|základ|dodavka|dodávky|oznaceni|označení|plu|barcode)\b/g, ' ')
    .replace(/[#:/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanMatchString(value) {
  return normalizeItemText(value)
    .replace(/\b\d+[.,]?\d*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeMatchToken(token) {
  const cleaned = normalizeText(token)
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  if (!cleaned || cleaned.length < 2 || /^\d+$/.test(cleaned)) return '';
  if (MATCH_STOPWORDS.has(cleaned)) return '';
  return cleaned;
}

function tokenizeForMatch(value) {
  return cleanMatchString(value)
    .split(/\s+/)
    .map(canonicalizeMatchToken)
    .filter(Boolean);
}

function toBigrams(value) {
  const compact = cleanMatchString(value).replace(/\s+/g, '');
  if (!compact) return [];
  if (compact.length < 2) return [compact];
  const grams = [];
  for (let index = 0; index < compact.length - 1; index += 1) grams.push(compact.slice(index, index + 2));
  return grams;
}

function diceSimilarity(left, right) {
  const leftBigrams = toBigrams(left);
  const rightBigrams = toBigrams(right);
  if (!leftBigrams.length || !rightBigrams.length) return 0;
  const counts = new Map();
  leftBigrams.forEach((gram) => counts.set(gram, (counts.get(gram) || 0) + 1));
  let overlap = 0;
  rightBigrams.forEach((gram) => {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  });
  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function weightedTokenOverlap(lineTokens, productTokens) {
  if (!lineTokens.length || !productTokens.length) return 0;
  const productSet = new Set(productTokens);
  const lineSet = new Set(lineTokens);
  const shared = productTokens.filter((token) => lineSet.has(token));
  if (!shared.length) return 0;
  const sharedRatio = shared.length / productSet.size;
  const reverseRatio = shared.length / Math.max(1, lineSet.size);
  return sharedRatio * 0.7 + reverseRatio * 0.3;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function containsExactCode(lineText, code) {
  const normalizedCode = normalizeText(code || '').replace(/\s+/g, '').trim();
  if (!normalizedCode || normalizedCode.length < 5) return false;
  const normalizedLine = normalizeText(lineText || '');
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedCode)}([^a-z0-9]|$)`, 'i').test(normalizedLine);
}

function scoreProductMatch(lineText, product) {
  const normalizedLine = cleanMatchString(lineText);
  const productName = cleanMatchString(product.name);
  if (!productName || !normalizedLine) return 0;

  if (product.barcode && containsExactCode(lineText, product.barcode)) return 120;
  if (product.plu && containsExactCode(lineText, product.plu)) return 110;
  if (normalizedLine.includes(productName) || productName.includes(normalizedLine)) return 100;

  const productTokens = tokenizeForMatch(product.name);
  const lineTokens = tokenizeForMatch(lineText);
  if (!productTokens.length || !lineTokens.length) return 0;

  const overlapScore = weightedTokenOverlap(lineTokens, productTokens);
  const tokenStringScore = diceSimilarity(lineTokens.join(' '), productTokens.join(' '));
  const phraseScore = diceSimilarity(normalizedLine, productName);
  const sameLeadToken = productTokens[0] && lineTokens[0] && productTokens[0] === lineTokens[0] ? 0.15 : 0;
  const sameHeadToken = productTokens.some((token) => lineTokens.includes(token)) ? 0.08 : 0;

  const combined = overlapScore * 0.55 + tokenStringScore * 0.25 + phraseScore * 0.20 + sameLeadToken + sameHeadToken;
  return combined >= 0.33 ? combined : 0;
}

function parseNumericTokens(line) {
  return [...line.matchAll(/-?\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g)]
    .map((match) => {
      const raw = match[0];
      const value = parseNumber(raw);
      const end = match.index + raw.length;
      const contextAfter = line.slice(end, end + 8).toLowerCase();
      const contextBefore = line.slice(Math.max(0, match.index - 6), match.index).toLowerCase();
      return {
        raw,
        value,
        index: match.index,
        end,
        isPercent: contextAfter.includes('%') || contextBefore.includes('%'),
      };
    })
    .filter((token) => token.value != null);
}

function extractQuantityInfo(line, product) {
  const totalWeightMatch = line.match(/celkem\s*:?\s*(\d+[.,]?\d*)\s*(kg|g)/i);
  if (totalWeightMatch) {
    const totalWeight = parseNumber(totalWeightMatch[1]);
    if (totalWeight != null) {
      const inKg = totalWeightMatch[2].toLowerCase() === 'g' ? totalWeight / 1000 : totalWeight;
      return { quantity: normalizeCartQuantity(inKg, product.unit), source: 'total-weight' };
    }
  }

  const directUnitMatches = [...line.matchAll(/(\d+[.,]?\d*)\s*(kg|g|ks|kus|bal|baleni|balení)/gi)];
  for (const match of directUnitMatches) {
    const rawQty = parseNumber(match[1]);
    const rawUnit = match[2]?.toLowerCase();
    if (rawQty == null || rawQty <= 0) continue;
    if (isWeightUnit(product.unit)) {
      if (rawUnit === 'kg') return { quantity: normalizeCartQuantity(rawQty, product.unit), source: 'direct-kg' };
      if (rawUnit === 'g') return { quantity: normalizeCartQuantity(rawQty / 1000, product.unit), source: 'direct-g' };
    } else if (['ks', 'kus', 'bal', 'baleni', 'balení'].includes(rawUnit)) {
      return { quantity: normalizeCartQuantity(rawQty, product.unit), source: 'direct-ks' };
    }
  }

  const numbers = parseNumericTokens(line).filter((token) => !token.isPercent).map((token) => token.value);
  if (!numbers.length) {
    return { quantity: getDefaultSaleQuantity(product.unit), source: 'default' };
  }

  if (isWeightUnit(product.unit)) {
    const packCount = directUnitMatches.find((match) => ['ks', 'kus', 'bal', 'baleni', 'balení'].includes(match[2]?.toLowerCase()));
    const packWeight = line.match(/(?:^|\s)(\d+[.,]?\d*)\s*(kg|g)\b/i);
    if (packCount?.[1] && packWeight?.[1]) {
      const count = parseNumber(packCount[1]);
      const rawWeight = parseNumber(packWeight[1]);
      if (count != null && rawWeight != null) {
        const weightKg = packWeight[2].toLowerCase() === 'g' ? rawWeight / 1000 : rawWeight;
        const total = count * weightKg;
        if (total > 0) {
          return { quantity: normalizeCartQuantity(total, product.unit), source: 'pack-times-weight' };
        }
      }
    }

    const qty = numbers.find((value) => value > 0 && value <= 2000);
    return { quantity: normalizeCartQuantity(qty ?? getQuantityStep(product.unit), product.unit), source: 'fallback-weight' };
  }

  const qty = numbers.find((value) => Number.isInteger(value) && value > 0 && value <= 9999);
  return { quantity: normalizeCartQuantity(qty ?? 1, product.unit), source: 'fallback-piece' };
}

function parseLinePrice(line, quantity, product) {
  const tokens = parseNumericTokens(line).filter((token) => !token.isPercent);
  const plausible = tokens.filter((token) => token.value > 0.01);
  if (!plausible.length) return Number(product.costPrice) || 0;

  const quantityLike = quantity > 0 ? quantity : null;
  let best = null;

  plausible.forEach((candidate, index) => {
    const value = candidate.value;
    let score = 0;

    if (value <= 0) return;
    if (quantityLike && quantityLike > 0) {
      for (let otherIndex = index + 1; otherIndex < plausible.length; otherIndex += 1) {
        const totalCandidate = plausible[otherIndex].value;
        if (totalCandidate <= value) continue;
        const diff = Math.abs(quantityLike * value - totalCandidate);
        const tolerance = Math.max(1, totalCandidate * 0.03);
        if (diff <= tolerance) score = Math.max(score, 100 - diff);
      }
    }

    if (value === Number(product.costPrice)) score += 4;
    if (value < 30 && plausible.length >= 3) score -= 20;
    if (String(candidate.raw).includes('000') && quantityLike && quantityLike < 2) score -= 5;
    if (/\bkc\b|kč/i.test(line.slice(candidate.end, candidate.end + 4))) score += 2;
    if (!best || score > best.score || (score === best.score && value < best.value)) {
      best = { value, score };
    }
  });

  if (!best || best.score < 0) {
    const sorted = plausible.map((token) => token.value).sort((a, b) => a - b);
    const candidate = sorted.find((value) => value > 1) ?? sorted[sorted.length - 1];
    return Number.isFinite(candidate) ? candidate : Number(product.costPrice) || 0;
  }

  return best.value;
}

function buildPdfRows(textContent) {
  const items = (textContent?.items || [])
    .filter((item) => item?.str && String(item.str).trim())
    .map((item) => ({
      str: String(item.str).trim(),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((a, b) => (Math.abs(b.y - a.y) > ROW_Y_TOLERANCE ? b.y - a.y : a.x - b.x));

  const rows = [];
  items.forEach((item) => {
    const lastRow = rows[rows.length - 1];
    if (!lastRow || Math.abs(lastRow.y - item.y) > ROW_Y_TOLERANCE) {
      rows.push({ y: item.y, items: [item] });
      return;
    }
    lastRow.items.push(item);
  });

  return rows.map((row) => {
    const sortedItems = row.items.sort((a, b) => a.x - b.x);
    return {
      y: row.y,
      cells: sortedItems,
      text: sortedItems.map((cell) => cell.str).join(' ').replace(/\s+/g, ' ').trim(),
    };
  });
}

function normalizeRowText(row) {
  return (row?.text || '').replace(/\s+/g, ' ').trim();
}

function isNoiseLine(normalizedLine) {
  if (!normalizedLine || normalizedLine.length < 3) return true;
  const line = normalizeText(normalizedLine).replace(/\s+/g, ' ').trim();
  if (!line) return true;

  const startsWithAny = [
    'dodavatel', 'odberatel', 'datum', 'doprava', 'uhrada', 'banka', 'iban', 'swift', 'ico', 'dic',
    'telefon', 'tel', 'mobil', 'email', 'e-mail', 'www', 'objednavka', 'variabilni', 'konstantni',
    'forma uhrady', 'konecny prijemce', 'platebni udaje', 'rekapitulace', 'souhrn', 'sazba dph',
    'zaklad dph', 'zaokrouhleni', 'celkem k uhrade', 'razitko', 'vystavil', 'strana', 'dodaci list',
    'kod producenta', 'minimalni', 'skladujte', 'qr platba', 'neopisujte', 'v mobilnim', 'zpusob platby'
  ];
  if (startsWithAny.some((prefix) => line.startsWith(prefix))) return true;
  if (/^qr\b/i.test(line)) return true;
  if (/^\d{1,2}\s*%\s+\d/.test(line)) return true;
  if (/^(celkem|zaokrouhleni|sazba dph|zaklad dph)\b/.test(line)) return true;
  return false;
}

function isNonStockLine(normalizedLine) {
  const line = normalizeText(normalizedLine);
  return /\b(doprava|dopravne|shipping|vyzvednuti u nas|hotove|prevodem|faktura s uhradou|na fakturu|platba|odpocet zalohy|vratny obal|zaloha)\b/i.test(line);
}

function looksLikeLineItem(lineText) {
  if (!lineText) return false;
  const rawLine = String(lineText).replace(/\s+/g, ' ').trim();
  if (isNoiseLine(rawLine)) return false;
  if (!/[a-zá-ž]/i.test(rawLine)) return false;

  const numericCount = (rawLine.match(/\d+[.,]?\d*/g) || []).length;
  if (numericCount < 2) return false;

  const productTokens = tokenizeForMatch(rawLine);
  if (!productTokens.length) return false;

  const hasQuantityOrUnit = /\b\d+[.,]?\d*\s*(kg|g|ks|kus|bal|baleni|balení|l|ml)\b/i.test(rawLine)
    || /\b\d+[.,]?\d*\s+[a-zá-ž]{2,}/i.test(rawLine);
  const hasPriceSignal = /\d+[.,]?\d*\s*kč/i.test(rawLine) || numericCount >= 4;
  if (!hasQuantityOrUnit || !hasPriceSignal) return false;

  if (/(celkem k uhrade|zaokrouhleni|sazba dph|zaklad dph|rekapitulace|souhrn)/i.test(normalizeText(rawLine))) return false;

  return true;
}

function looksLikeLooseItem(lineText) {
  if (!lineText) return false;
  const rawLine = String(lineText).replace(/\s+/g, ' ').trim();
  if (isNoiseLine(rawLine)) return false;
  if (isNonStockLine(rawLine)) return false;
  if (!/[a-zá-ž]/i.test(rawLine)) return false;
  const numericCount = (rawLine.match(/\d+[.,]?\d*/g) || []).length;
  if (numericCount < 3) return false;
  const productTokens = tokenizeForMatch(rawLine);
  if (!productTokens.length) return false;
  return true;
}

function mergeInvoiceLines(inputLines) {
  const lines = [];
  for (let index = 0; index < inputLines.length; index += 1) {
    const current = String(inputLines[index] || '').trim();
    if (!current) continue;

    const next = String(inputLines[index + 1] || '').trim();
    let merged = current;

    const currentLooksIncomplete = /[a-zá-ž]/i.test(current) && !(current.match(/\d+[.,]?\d*/g) || []).length;
    const nextLooksNumeric = next && ((next.match(/\d+[.,]?\d*/g) || []).length >= 2 || /^\d+[.,]?\d*\s*(kg|g|ks|kus)/i.test(next));
    if (currentLooksIncomplete && nextLooksNumeric) {
      merged = `${current} ${next}`;
      index += 1;
      const third = String(inputLines[index + 1] || '').trim();
      if (third && /^(šarže|sarze|celkem:|cena\/kg:)/i.test(third)) {
        merged = `${merged} ${third}`;
        index += 1;
      }
      lines.push(merged.replace(/\s+/g, ' ').trim());
      continue;
    }

    if (next && /^(šarže|sarze|celkem:|cena\/kg:)/i.test(next)) {
      merged = `${current} ${next}`;
      index += 1;
    }

    lines.push(merged.replace(/\s+/g, ' ').trim());
  }
  return lines;
}

function extractMatchedItems(lines, products) {
  const aggregated = new Map();
  const lowConfidenceMatches = [];

  function acceptLine(line, loose = false) {
    const normalizedLine = normalizeItemText(line);
    if (!(loose ? looksLikeLooseItem(line) : looksLikeLineItem(line))) return;
    if (isNonStockLine(line)) return;

    const candidates = products
      .map((product) => ({ product, score: scoreProductMatch(line, product) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    const bestCandidate = candidates[0];
    if (!bestCandidate) return;
    const { product: bestProduct, score: bestScore } = bestCandidate;
    const automaticMatch = [100, 110, 120].includes(bestScore) || bestScore >= (loose ? 0.40 : 0.48);
    if (!automaticMatch) return;

    const quantityInfo = extractQuantityInfo(line, bestProduct);
    const quantity = quantityInfo.quantity;
    if (!quantity || quantity <= 0) return;

    const purchasePrice = parseLinePrice(line, quantity, bestProduct);
    const existing = aggregated.get(bestProduct.id);
    const matchConfidence = Math.max(0, Math.min(100, Math.round(([100, 110, 120].includes(bestScore) ? 1 : bestScore) * 100)));
    const alternatives = candidates.slice(1).map((entry) => ({ productId: entry.product.id, productName: entry.product.name, score: Math.round(entry.score * 100) }));
    if (matchConfidence < 72) {
      lowConfidenceMatches.push({ sourceLine: line, productName: bestProduct.name, confidence: matchConfidence });
    }

    if (existing) {
      existing.quantity = normalizeCartQuantity(existing.quantity + quantity, bestProduct.unit);
      if (!existing.purchasePrice && purchasePrice) existing.purchasePrice = purchasePrice;
      existing.sourceLine = `${existing.sourceLine} | ${line}`;
      existing.matchConfidence = Math.max(existing.matchConfidence || 0, matchConfidence);
      if (!existing.matchAlternatives?.length && alternatives.length) existing.matchAlternatives = alternatives;
      existing.matchStrategy = existing.matchStrategy || ([100, 110, 120].includes(bestScore) ? 'exact' : 'similarity');
      return;
    }

    aggregated.set(bestProduct.id, {
      productId: bestProduct.id,
      productName: bestProduct.name,
      category: bestProduct.category,
      unit: bestProduct.unit,
      currentStock: Number(bestProduct.stock) || 0,
      purchasePrice: purchasePrice || Number(bestProduct.costPrice) || 0,
      salePrice: Number(bestProduct.price) || 0,
      quantity,
      sourceLine: line,
      matchConfidence,
      matchStrategy: [100, 110, 120].includes(bestScore) ? 'exact' : 'similarity',
      matchAlternatives: alternatives,
    });
  }

  lines.forEach((line) => acceptLine(line, false));
  if (!aggregated.size) {
    lines.forEach((line) => acceptLine(line, true));
  }

  return {
    items: [...aggregated.values()],
    lowConfidenceMatches,
  };
}

function parseInvoiceText(text, { products = [], suppliers = [], lineHints = [] } = {}) {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const metadataLines = [...new Set(mergeInvoiceLines([...rawLines, ...lineHints]))];
  const hintedItemLines = [...new Set(mergeInvoiceLines(lineHints))];
  const rawItemLines = [...new Set(mergeInvoiceLines(rawLines))];
  const supplierName = guessSupplier(text, metadataLines, suppliers);
  const documentNumber = parseDocumentNumber(metadataLines);
  const stockedAt = parseDateFromText(text);
  let { items, lowConfidenceMatches } = extractMatchedItems(hintedItemLines.length ? hintedItemLines : rawItemLines, products);
  if (!items.length && hintedItemLines.length) {
    const fallback = extractMatchedItems(rawItemLines, products);
    items = fallback.items;
    lowConfidenceMatches = fallback.lowConfidenceMatches;
  }

  const warnings = [];
  if (!items.length) warnings.push('OCR nenašlo žádné produkty. Zkontroluj text nebo přidej položky ručně.');
  if (lowConfidenceMatches.length) {
    const preview = lowConfidenceMatches.slice(0, 3).map((entry) => `${entry.sourceLine} → ${entry.productName} (${entry.confidence} %)`).join('; ');
    warnings.push(`Některé položky byly napárované podle nejvyšší podobnosti a je potřeba je zkontrolovat: ${preview}${lowConfidenceMatches.length > 3 ? '…' : ''}`);
  }
  if (!supplierName) warnings.push('Nepodařilo se spolehlivě poznat dodavatele.');
  if (!documentNumber) warnings.push('Nepodařilo se najít číslo faktury / dodacího listu.');
  if (/prirodni kosmetika caltha dle dodaciho listu|přírodní kosmetika caltha dle dodacího listu/i.test(text)) {
    warnings.push('Tahle faktura odkazuje na dodací list a neobsahuje rozepsané položky. Položky bude potřeba doplnit ručně nebo načíst z dodacího listu.');
  }
  if (/^\s*faktura\s*-?\s*da[ňn]ovy doklad\s*2025/i.test(normalizeText(text)) && /odberatel\s+miki strejcku|odběratel\s+miki strejčků/i.test(normalizeText(text))) {
    warnings.push('Doklad vypadá jako vydaná faktura z vaší prodejny, ne jako přijatá faktura od dodavatele.');
  }

  return {
    supplierName,
    documentNumber,
    stockedAt,
    items,
    rawText: text,
    warnings,
  };
}

async function recognizeImageFile(file, onProgress) {
  const { recognize } = await import('tesseract.js');
  const result = await recognize(file, 'ces+eng', {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        emitProgress(onProgress, { percent: Math.round((message.progress || 0) * 100), message: 'OCR z obrázku' });
      }
    },
  });
  return {
    text: result?.data?.text || '',
    confidence: result?.data?.confidence ?? null,
    sourceType: 'image',
    lineHints: [],
  };
}

async function renderPageToDataUrl(page, scale = 2.5) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function recognizePdfFile(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  emitProgress(onProgress, { percent: 5, message: 'Načítám PDF' });
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  loadingTask.onProgress = (progressData) => {
    const base = progressData?.total ? Math.round((progressData.loaded / progressData.total) * 20) : 10;
    emitProgress(onProgress, { percent: Math.max(5, Math.min(25, base)), message: 'Načítám PDF' });
  };

  const pdf = await loadingTask.promise;
  const texts = [];
  const rowHints = [];
  const pageLimit = Math.min(pdf.numPages, MAX_PDF_TEXT_PAGES);

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    emitProgress(onProgress, { percent: 20 + Math.round((pageNumber / pageLimit) * 20), message: `Čtu text z PDF · strana ${pageNumber}/${pageLimit}` });
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join('\n');
    texts.push(pageText);
    const pageRows = buildPdfRows(textContent).map((row) => normalizeRowText(row)).filter(Boolean);
    rowHints.push(...pageRows);
  }

  const directText = [...texts, ...rowHints].join('\n');
  if (directText.replace(/\s+/g, ' ').trim().length >= 120) {
    emitProgress(onProgress, { percent: 100, message: 'Text načten přímo z PDF' });
    return { text: directText, confidence: null, sourceType: 'pdf-text', lineHints: rowHints };
  }

  const { recognize } = await import('tesseract.js');
  const ocrTexts = [];
  let confidenceSum = 0;
  let confidenceCount = 0;
  const ocrPageLimit = Math.min(pdf.numPages, MAX_PDF_OCR_PAGES);

  for (let pageNumber = 1; pageNumber <= ocrPageLimit; pageNumber += 1) {
    emitProgress(onProgress, { percent: 40 + Math.round(((pageNumber - 1) / ocrPageLimit) * 10), message: `Připravuji OCR z PDF · strana ${pageNumber}/${ocrPageLimit}` });
    const page = await pdf.getPage(pageNumber);
    const imageUrl = await renderPageToDataUrl(page, 2.5);
    const result = await recognize(imageUrl, 'ces+eng', {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          const local = message.progress || 0;
          const pageBase = 50 + ((pageNumber - 1) / ocrPageLimit) * 40;
          const percent = Math.round(pageBase + local * (40 / ocrPageLimit));
          emitProgress(onProgress, { percent, message: `OCR z PDF · strana ${pageNumber}/${ocrPageLimit}` });
        }
      },
    });
    ocrTexts.push(result?.data?.text || '');
    if (Number.isFinite(result?.data?.confidence)) {
      confidenceSum += result.data.confidence;
      confidenceCount += 1;
    }
  }

  emitProgress(onProgress, { percent: 100, message: 'OCR z PDF hotovo' });
  return {
    text: ocrTexts.join('\n'),
    confidence: confidenceCount ? confidenceSum / confidenceCount : null,
    sourceType: 'pdf-ocr',
    lineHints: [],
  };
}

export async function recognizeInvoiceDocument(file, context, onProgress = () => {}) {
  const isPdf = file?.type === 'application/pdf' || String(file?.name || '').toLowerCase().endsWith('.pdf');
  const result = isPdf ? await recognizePdfFile(file, onProgress) : await recognizeImageFile(file, onProgress);
  const parsed = parseInvoiceText(result.text, { ...context, lineHints: result.lineHints || [] });
  return {
    ...parsed,
    confidence: result.confidence,
    sourceType: result.sourceType,
  };
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const semanticColorRules = [
  { hue: 52, keys: ['banan', 'citron', 'citrus', 'mango', 'kukur', 'med', 'kurkum', 'vejce', 'svickov', 'horcice'] },
  { hue: 18, keys: ['rajcat', 'malin', 'jahod', 'visen', 'tresn', 'paprik', 'chilli', 'bolo', 'sunk', 'maso', 'hov', 'klobas', 'pikant'] },
  { hue: 334, keys: ['ruz', 'levand', 'kosmetik', 'voda', 'liker', 'granat', 'brusink'] },
  { hue: 272, keys: ['boruv', 'ostruz', 'sliv', 'kava', 'fial', 'oliv'] },
  { hue: 206, keys: ['mleko', 'kefir', 'jogurt', 'syrovat', 'cistic', 'pradlo', 'myck', 'nadobi', 'gel', 'machadl'] },
  { hue: 145, keys: ['bio', 'herb', 'bylin', 'matcha', 'pesto', 'salat', 'zelen', 'spenat', 'okur', 'medved', 'cuket', 'hliv', 'zivina'] },
  { hue: 34, keys: ['mandle', 'kesu', 'orech', 'pekan', 'lyofil', 'cokolad', 'kakao', 'susen', 'granola', 'sirup', 'caj'] },
  { hue: 10, keys: ['syr', 'halloumi', 'tvaroh', 'maslo', 'ghi', 'pareny', 'gouda', 'balkan'] },
];



export const PRODUCT_COLOR_PALETTE = [
  { key: 'sky', label: 'Modrá', hue: 206 },
  { key: 'cyan', label: 'Tyrkysová', hue: 184 },
  { key: 'mint', label: 'Mátová', hue: 154 },
  { key: 'lime', label: 'Limetková', hue: 92 },
  { key: 'yellow', label: 'Žlutá', hue: 48 },
  { key: 'orange', label: 'Oranžová', hue: 28 },
  { key: 'rose', label: 'Růžová', hue: 340 },
  { key: 'violet', label: 'Fialová', hue: 270 },
  { key: 'slate', label: 'Šedá', hue: 215 },
];

export function getPaletteColor(key) {
  return PRODUCT_COLOR_PALETTE.find((item) => item.key === key) || null;
}

function buildStyleFromHue(hue) {
  return { '--tile-h': `${Number(hue) || 206}` };
}

const familyRules = [
  ['kefíry', ['kefir']],
  ['jogurty', ['jogurt']],
  ['mléka', ['mleko']],
  ['sýry', ['syr', 'gouda', 'halloumi', 'balkan', 'pareny', 'uzeny', 'tvaroh', 'pecka z hedce']],
  ['máslo a ghí', ['maslo', 'ghi']],
  ['vejce', ['vejce']],
  ['vody a hydroláty', ['voda', 'hydrolat']],
  ['pesta a dipy', ['pesto', 'dip']],
  ['omáčky', ['omacka', 'kari', 'thai', 'kung pao', 'hoisin', 'teriyaki', 'pho', 'ramen', 'protlak', 'nakladack']],
  ['prací a drogerie', ['pradlo', 'machadlo', 'gel na nadobi', 'prostredek', 'mycka', 'avivaz', 'lestidlo']],
  ['ořechy a dobroty', ['mandle', 'kesu', 'orech', 'pekan', 'lyofil', 'cokolad', 'susene']],
  ['medy a sirupy', ['med', 'sirup']],
  ['kosmetika', ['kosmetik', 'caltha', 'purity vision', 'balzam', 'krem', 'olej']],
  ['sklenice a obaly', ['sklenic', 'vicko', 'obal', 'krabick']],
];

const stopWords = new Set(['bio', 'ks', 'kg', 'l', 'ml', 'g', 'balicek', 'baleni', 'maly', 'velky', 'maly']);
const variantPriority = ['neochuceny', 'bila', 'cerna', 'vanilka', 'jahoda', 'boruvka', 'visen', 'kava', 'citron', 'malina', 'kokos'];

export function getSemanticHue(name, category) {
  const text = normalize(`${category || ''} ${name || ''}`);
  for (const rule of semanticColorRules) {
    if (rule.keys.some((key) => text.includes(key))) return rule.hue;
  }
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return [18, 34, 52, 145, 206, 272, 334][hash % 7];
}

export function getFamilyKey(product) {
  const text = normalize(product?.name || '');
  for (const [family, keys] of familyRules) {
    if (keys.some((key) => text.includes(key))) return family;
  }
  return text.split(' ')[0] || 'ostatní';
}

export function getVariantKey(product) {
  const text = normalize(product?.name || '');
  for (const token of variantPriority) {
    if (text.includes(token)) return token;
  }
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((token) => !stopWords.has(token))
    .filter((token) => !/^\d+(?:[.,]\d+)?(?:kg|g|ml|l)?$/.test(token));
  const familyTokens = normalize(getFamilyKey(product)).split(' ');
  const firstMeaningful = tokens.find((token) => !familyTokens.includes(token));
  return firstMeaningful || text;
}

export function sortCategories(categories = []) {
  const only = categories.filter((category) => category && category !== 'Vše');
  const sorted = only.sort((a, b) => {
    const hueDiff = getSemanticHue(a, a) - getSemanticHue(b, b);
    if (hueDiff !== 0) return hueDiff;
    return a.localeCompare(b, 'cs');
  });
  return categories.includes('Vše') ? ['Vše', ...sorted] : sorted;
}

function hasManualOrder(product) {
  return Number.isFinite(Number(product?.displayOrder));
}

function compareWithinCategory(a, b) {
  const aManual = hasManualOrder(a);
  const bManual = hasManualOrder(b);
  if (aManual || bManual) {
    const orderDiff = (aManual ? Number(a.displayOrder) : Number.MAX_SAFE_INTEGER) - (bManual ? Number(b.displayOrder) : Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) return orderDiff;
  }
  const familyCompare = getFamilyKey(a).localeCompare(getFamilyKey(b), 'cs');
  if (familyCompare !== 0) return familyCompare;
  const variantCompare = getVariantKey(a).localeCompare(getVariantKey(b), 'cs');
  if (variantCompare !== 0) return variantCompare;
  return String(a.name || '').localeCompare(String(b.name || ''), 'cs');
}

export function sortProductsForCatalog(products = []) {
  return [...products].sort((a, b) => {
    const categoryCompare = String(a.category || '').localeCompare(String(b.category || ''), 'cs');
    if (categoryCompare !== 0) return categoryCompare;
    return compareWithinCategory(a, b);
  });
}

export function sortProductsWithinCategory(products = []) {
  return [...products].sort(compareWithinCategory);
}

export function buildVisualStyle(entity, index = 0) {
  const hue = getSemanticHue(entity?.name || entity, entity?.category || entity);
  const rotations = [0, 18, -16, 10, -10, 24, -24];
  return {
    '--tile-h': `${(hue + rotations[index % rotations.length] + 360) % 360}`,
  };
}

export function getCategoryMeta(category, index = 0) {
  return { label: category, style: buildVisualStyle(category, index) };
}

export function getProductMeta(product, groupIndex = 0) {
  const customColor = getPaletteColor(product?.tileColor || product?.colorKey || product?.productColor);
  return {
    family: getFamilyKey(product),
    variant: getVariantKey(product),
    style: customColor ? buildStyleFromHue(customColor.hue) : buildVisualStyle(product, 0),
    colorKey: customColor?.key || '',
    colorLabel: customColor?.label || 'Automatická',
  };
}

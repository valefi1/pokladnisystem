export function normalizeUnit(unit) {
  return String(unit || 'ks').trim().toLowerCase();
}

export function isWeightUnit(unit) {
  return ['kg', 'kilogram', 'kilogramy', 'kilogramu'].includes(normalizeUnit(unit));
}

export function getQuantityStep(unit) {
  return isWeightUnit(unit) ? 0.001 : 1;
}

export function getQuantityMin(unit) {
  return isWeightUnit(unit) ? 0.001 : 1;
}

export function roundQuantity(value, unit) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (isWeightUnit(unit)) {
    return Number(parsed.toFixed(3));
  }
  return Math.round(parsed);
}

export function sanitizePositiveQuantity(value, unit) {
  const rounded = roundQuantity(value, unit);
  return Math.max(getQuantityMin(unit), rounded);
}

export function normalizeCartQuantity(value, unit) {
  const rounded = roundQuantity(value, unit);
  if (rounded <= 0) return 0;
  return rounded;
}

export function getDefaultSaleQuantity(unit) {
  return getQuantityMin(unit);
}

export function formatUnitLabel(unit) {
  return isWeightUnit(unit) ? 'kg' : 'ks';
}

export function inferUnitFromQuantity(quantity) {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) return 'ks';
  return Math.abs(parsed % 1) > 0.0001 ? 'kg' : 'ks';
}

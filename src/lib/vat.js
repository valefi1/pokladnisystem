export function roundMoney(value) {
  const num = Number(value) || 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function getVatRate(value, fallback = 12) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return fallback;
  return rate;
}

export function netFromGross(gross, vatRate = 12) {
  const rate = getVatRate(vatRate, 0);
  const value = Number(gross) || 0;
  if (rate <= 0) return roundMoney(value);
  return roundMoney(value / (1 + rate / 100));
}

export function grossFromNet(net, vatRate = 12) {
  const rate = getVatRate(vatRate, 0);
  const value = Number(net) || 0;
  if (rate <= 0) return roundMoney(value);
  return roundMoney(value * (1 + rate / 100));
}

export function vatFromGross(gross, vatRate = 12) {
  return roundMoney((Number(gross) || 0) - netFromGross(gross, vatRate));
}

export function normalizeProductVatPricing(product = {}) {
  const vatRate = getVatRate(product.vatRate, 12);
  const priceWithVat = Number.isFinite(Number(product.priceWithVat))
    ? roundMoney(product.priceWithVat)
    : Number.isFinite(Number(product.price))
      ? roundMoney(product.price)
      : grossFromNet(product.priceWithoutVat, vatRate);
  const priceWithoutVat = Number.isFinite(Number(product.priceWithoutVat))
    ? roundMoney(product.priceWithoutVat)
    : netFromGross(priceWithVat, vatRate);

  return {
    ...product,
    vatRate,
    price: priceWithVat,
    priceWithVat,
    priceWithoutVat,
  };
}

export function buildVatBreakdown(items = [], orderDiscountAmount = 0) {
  const totalAfterItemDiscounts = items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0);
  const rows = new Map();

  for (const item of items) {
    const vatRate = getVatRate(item.vatRate, 12);
    const lineTotal = Number(item.lineTotal) || 0;
    const discountShare = totalAfterItemDiscounts > 0 ? (lineTotal / totalAfterItemDiscounts) * (Number(orderDiscountAmount) || 0) : 0;
    const taxableGross = Math.max(0, lineTotal - discountShare);
    const base = netFromGross(taxableGross, vatRate);
    const vat = roundMoney(taxableGross - base);
    const key = String(vatRate);
    const existing = rows.get(key) || { vatRate, base: 0, vat: 0, gross: 0 };
    existing.base = roundMoney(existing.base + base);
    existing.vat = roundMoney(existing.vat + vat);
    existing.gross = roundMoney(existing.gross + taxableGross);
    rows.set(key, existing);
  }

  return [...rows.values()].sort((a, b) => a.vatRate - b.vatRate);
}

export const formatCurrency = (value) =>
  new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

export const formatDateTime = (value) =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export const formatDate = (value) =>
  new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));

export const formatQuantity = (value, max = 3) =>
  new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
  }).format(Number(value) || 0);

export const formatDaysToZero = (value) => {
  if (value == null) return '—';
  if (value < 1) return '< 1 den';
  if (value < 30) return `${formatQuantity(value, 1)} dne`;
  return `${Math.round(value)} dnů`;
};

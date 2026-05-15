const KEY = 'nezavisla-pos-device-debug-v1';
const MAX_ENTRIES = 250;

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

export function loadDeviceLogs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Nepodařilo se načíst debug log zařízení', error);
    return [];
  }
}

export function saveDeviceLogs(entries) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (error) {
    console.error('Nepodařilo se uložit debug log zařízení', error);
  }
}

export function addDeviceLog(scope, message, details = null, level = 'info') {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    scope,
    level,
    message,
    details,
  };
  const next = [entry, ...loadDeviceLogs()].slice(0, MAX_ENTRIES);
  saveDeviceLogs(next);
  return entry;
}

export function clearDeviceLogs() {
  try {
    window.localStorage.removeItem(KEY);
  } catch (error) {
    console.error('Nepodařilo se vymazat debug log zařízení', error);
  }
}

export function exportDeviceLogs() {
  const payload = {
    exportedAt: new Date().toISOString(),
    entries: loadDeviceLogs(),
  };
  const blob = new Blob([safeStringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `device-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function formatLogDetails(details) {
  if (details == null) return '';
  return safeStringify(details);
}

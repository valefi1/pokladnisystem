const KEY = 'nezavisla-pos-device-prefs-v2';

const defaults = {
  printerMode: 'browser-print',
  printerPaper: '80mm',
  printerLabel: 'USB termální tiskárna podobná Epson TM-T20III',
  printerUsbHint: 'USB přes systémový tisk ve Windows',
  printerAutoPrint: true,
  printerCopies: 1,
  terminalMode: 'dotypay-sim',
  terminalLabel: 'Dotypay · N86 Pro',
  terminalProtocol: 'wifi',
  terminalHost: '',
  terminalApiKey: '',
  terminalSaleId: 'NEZAVISLA-POS',
  terminalPairingCode: '',
  terminalTimeoutSec: 45,
  terminalScenario: 'approved',
  terminalAutoConnect: false,
  debugEnabled: true,
};

export function loadDevicePrefs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch (error) {
    console.error('Nepodařilo se načíst nastavení zařízení', error);
    return defaults;
  }
}

export function saveDevicePrefs(prefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error('Nepodařilo se uložit nastavení zařízení', error);
  }
}

export function getDefaultDevicePrefs() {
  return defaults;
}

export function getDeviceCapabilities() {
  if (typeof window === 'undefined') {
    return { secureContext: false, print: false, serial: false, usb: false, hid: false, online: false };
  }
  return {
    secureContext: window.isSecureContext,
    print: typeof window.print === 'function',
    serial: Boolean(navigator?.serial),
    usb: Boolean(navigator?.usb),
    hid: Boolean(navigator?.hid),
    online: navigator?.onLine ?? true,
  };
}

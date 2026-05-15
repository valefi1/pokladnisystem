import { demoState } from '../data/demoData';
import { normalizeState } from '../data/initialState';

const STORAGE_KEY = 'nezavisla-pos-web-mvp-v9';

export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeState(demoState);
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.error('Nepodařilo se načíst lokální data', error);
    return normalizeState(demoState);
  }
}

export function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  } catch (error) {
    console.error('Nepodařilo se uložit lokální data', error);
  }
}

export function resetState() {
  window.localStorage.removeItem(STORAGE_KEY);
  return normalizeState(demoState);
}

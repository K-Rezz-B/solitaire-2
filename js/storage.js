// Persistance locale uniquement. try/catch : Safari privé / quota plein lèvent des exceptions.
const PREFIX = 'solitaire:v1:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return fallback && typeof fallback === 'object' && !Array.isArray(fallback)
      ? { ...fallback, ...value }
      : value;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* stockage indisponible : le jeu reste jouable */ }
}

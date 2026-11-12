// Light and dark themes. The choice is kept in localStorage; without one, the system setting wins.
const KEY = 'nf-theme';

function stored() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // storage can be blocked; the theme still works for this visit
  }
}

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  return set === 'light' || set === 'dark' ? set : (stored() ?? systemTheme());
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#18181b' : '#ffffff');
}

/** Call once before the first render so there is no flash of the wrong theme. */
export function initTheme() {
  applyTheme(stored() ?? systemTheme());
}

export function chooseTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // not remembered, still applied
  }
}

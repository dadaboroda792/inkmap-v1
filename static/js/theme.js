const THEME_KEY = 'inkmap-theme';
const BG_KEY = 'inkmap-bg';

export function currentTheme() {
  return document.documentElement.dataset.theme || 'dark';
}
export function currentBg() {
  return document.documentElement.dataset.bg || 'dots';
}

export function initTheme() {
  const theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  const bg = ['dots', 'lines', 'grid', 'plain'].includes(localStorage.getItem(BG_KEY))
    ? localStorage.getItem(BG_KEY) : 'dots';
  applyTheme(theme);
  applyBg(bg);

  const btn = document.getElementById('btn-theme');
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  const bgBtn = document.getElementById('btn-bg');
  const menu = document.getElementById('bg-menu');
  bgBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
    [...menu.children].forEach(b => b.classList.toggle('active', b.dataset.bg === currentBg()));
  });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-bg]');
    if (!b) return;
    localStorage.setItem(BG_KEY, b.dataset.bg);
    applyBg(b.dataset.bg);
    menu.classList.add('hidden');
  });
  document.addEventListener('click', () => menu.classList.add('hidden'));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('icon-moon').classList.toggle('hidden', theme === 'dark');
  document.getElementById('icon-sun').classList.toggle('hidden', theme !== 'dark');
  document.dispatchEvent(new CustomEvent('ink:theme'));
}

function applyBg(bg) {
  document.documentElement.dataset.bg = bg;
}

export function refreshSvgColors() {
  document.dispatchEvent(new CustomEvent('ink:theme'));
}

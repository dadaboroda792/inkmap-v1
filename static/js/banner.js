export function banner(text, ms = 4000) {
  const el = document.getElementById('banner');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(banner._t);
  banner._t = setTimeout(() => el.classList.add('hidden'), ms);
}

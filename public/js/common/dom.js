// Tiny shared helpers: element lookup, safe values from the server, settings storage, the toast.
export const $ = (s) => document.querySelector(s);
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v)) ? v : d;
export const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c : '#8899aa';
export const safeName = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').trim().slice(0, 14) : '') || 'Snowfighter';
export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

let toastTimer = null;
// `small`: a quieter toast higher up, for chat lines and notices.
export function toast(main, sub = '', ms = 1600, small = false) {
  const t = $('#toast'); t.textContent = main; t.classList.toggle('small', small);
  if (sub) { const s = document.createElement('small'); s.textContent = sub; t.appendChild(s); }
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

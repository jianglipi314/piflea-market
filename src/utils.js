/* ============ Utility Functions ============ */

/**
 * Format price to 2 decimal places
 */
export function fmtPrice(p) {
  const n = Number(p);
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c];
  });
}

/**
 * Time ago display
 */
export function timeAgo(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return Math.floor(d / 86400000) + ' 天前';
}

/**
 * Fallback copy for older browsers
 */
export function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

/**
 * Get a stable local user ID (generated once, persisted)
 */
export function getOwnerId() {
  const OWNER_KEY = 'pi_flea_owner_v3';
  let uid = localStorage.getItem(OWNER_KEY);
  if (!uid) {
    const rnd = (n) => {
      const s = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let out = '';
      for (let i = 0; i < n; i++) out += s[Math.floor(Math.random() * s.length)];
      return out;
    };
    uid = 'u_' + Date.now().toString(36) + '_' + rnd(8);
    localStorage.setItem(OWNER_KEY, uid);
  }
  return uid;
}

/**
 * Get the Pi UID if authenticated, else null.
 */
export function getPiUid() {
  try {
    const cached = localStorage.getItem('pi_flea_pi_user_v1');
    if (cached) {
      const user = JSON.parse(cached);
      return user.uid || null;
    }
  } catch (e) {}
  return null;
}

/**
 * Get the best available user ID: Pi UID first, fallback to local owner ID.
 * This ensures Pi-authenticated users are identified by their real Pi UID,
 * while unauthenticated users still have a stable local identity.
 */
export function getCurrentUserId() {
  return getPiUid() || getOwnerId();
}

/**
 * Get all user IDs that belong to the current user (Pi UID + local ID).
 * Use this for queries that need to match either identity.
 */
export function getAllMyUserIds() {
  const ids = [getOwnerId()];
  const piUid = getPiUid();
  if (piUid && !ids.includes(piUid)) ids.push(piUid);
  return ids;
}

/**
 * Debounce — returns a function that delays invoking fn until after `ms` of inactivity.
 */
export function debounce(fn, ms = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Toast — lightweight notification
 */
let toastTimer = null;

export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

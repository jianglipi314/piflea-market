/* ============ Card HTML Builders ============ */

import { escapeHtml, fmtPrice } from '../utils';

/**
 * Generate HTML for a horizontal scroll recommended item.
 */
export function recoHTML(it) {
  return `<div class="reco" onclick="window.openDetail(${it.id})">
    <div class="img">${
      it.images && it.images[0]
        ? `<img src="${it.images[0]}" loading="lazy" decoding="async" onerror="this.style.display='none'"/>`
        : it.emoji
    }<span class="tag">${it.status === 'sold' ? '🏁 已售' : '🔥 推荐'}</span></div>
    <div class="body">
      <p class="t">${escapeHtml(it.title)}</p>
      <div class="p">${fmtPrice(it.price)} <small style="color:var(--ink-2)">π</small></div>
      <div class="meta"><span>${escapeHtml(it.seller || '')}</span><span>👁 ${it.views || 0}</span></div>
    </div>
  </div>`;
}

/**
 * Generate HTML for a grid card item.
 */
export function cardHTML(it) {
  const badges = [];
  if (it.tpl === 'reco') badges.push('<span class="badge">🔥 推荐</span>');
  if (it.status === 'sold') badges.push('<span class="badge" style="background:rgba(100,116,139,.95)">已售</span>');
  if (it.city) badges.push('<span class="badge verify">认证</span>');

  return `<div class="card" onclick="window.openDetail(${it.id})">
    <div class="pic">
      ${
        it.images && it.images[0]
          ? `<img src="${it.images[0]}" loading="lazy" decoding="async" onerror="this.style.display='none'"/>`
          : it.emoji
      }
      ${badges.join('')}
    </div>
    <div class="info">
      <p class="title">${escapeHtml(it.title)}</p>
      <div class="price-row">
        <div class="price">${fmtPrice(it.price)}<small> π</small></div>
        <div style="font-size:11px;color:var(--ink-2)">${it.cat}</div>
      </div>
      <div class="seller">
        <div class="avatar">${(it.seller || 'U').slice(0, 1)}</div>
        <span>${escapeHtml(it.seller || '卖家')}</span>
        <span class="fav-count">👁 ${it.views || 0}</span>
      </div>
    </div>
  </div>`;
}

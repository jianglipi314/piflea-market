/* ============ Card HTML Builders ============ */

import { escapeHtml, fmtPrice, timeAgo } from '../utils';

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
 * 闲鱼/转转风格：图片 → 标题 → 价格（π图标）→ 元信息（城市/浏览/收藏/时间）
 * 空字段不渲染对应片段。
 */
export function cardHTML(it) {
  const badges = [];
  if (it.tpl === 'reco') badges.push('<span class="badge">🔥 推荐</span>');
  if (it.status === 'sold') badges.push('<span class="badge" style="background:rgba(100,116,139,.95)">已售</span>');
  if (it.city) badges.push('<span class="badge verify">认证</span>');

  // 元信息片段：按需拼接，空值不显示
  const metaParts = [];
  if (it.city) metaParts.push(`<span class="cm-loc">📍 ${escapeHtml(it.city)}</span>`);
  metaParts.push(`<span class="cm-views">👁 ${it.views || 0}</span>`);
  if (it.fav_count && it.fav_count > 0) metaParts.push(`<span class="cm-fav">❤️ ${it.fav_count}</span>`);
  if (it.created_at) {
    const ts = new Date(it.created_at).getTime();
    if (!isNaN(ts)) metaParts.push(`<span class="cm-time">${timeAgo(ts)}</span>`);
  }

  // 运费/包邮标签
  const shipLabel = it.shipping_fee > 0
    ? `运费 ${fmtPrice(it.shipping_fee)}π`
    : '包邮';

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
        <div class="price"><span class="pi-ico">π</span>${fmtPrice(it.price)}</div>
        <div class="ship-tag">${shipLabel}</div>
      </div>
      <div class="card-meta">${metaParts.join('')}</div>
    </div>
  </div>`;
}

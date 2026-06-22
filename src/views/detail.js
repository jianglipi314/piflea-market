/* ============ Detail View ============ */

import { state } from '../main';
import { HIST_KEY } from '../state';
import { escapeHtml, fmtPrice, timeAgo, fallbackCopy, toast, getAllMyUserIds, getCurrentUserId } from '../utils';
import { openSheet } from '../components/sheet';
import { getSupabase } from '../supabase';

let heroImgIdx = 0;

/**
 * Open detail view for an item.
 */
export async function openDetail(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) { toast('商品不存在'); return; }

  state.currentDetailId = id;

  // Increment views
  const supabase = getSupabase();
  supabase
    .from('items')
    .update({ views: (it.views || 0) + 1 })
    .eq('id', id)
    .then(() => {});
  it.views = (it.views || 0) + 1;

  // Save to history
  state.history = [
    { id, t: Date.now() },
    ...state.history.filter((h) => h.id !== id),
  ].slice(0, 50);
  localStorage.setItem(HIST_KEY, JSON.stringify(state.history));

  // Switch view
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-detail').classList.add('active');
  document.querySelectorAll('.nav button').forEach((b) => b.classList.remove('on'));

  // 更新顶部标题为"商品详情"
  document.getElementById('topTitle').textContent = '商品详情';
  document.getElementById('topSub').textContent = '云端实时同步';

  // Populate fields
  document.getElementById('d-title').textContent = it.title;
  document.getElementById('d-price').textContent = fmtPrice(it.price);
  document.getElementById('d-desc').textContent = it.desc || '（暂无描述）';
  document.getElementById('d-seller').textContent = it.seller || '卖家';
  document.getElementById('d-avatar').textContent = (it.seller || 'U').slice(0, 1);
  document.getElementById('d-emoji').textContent = it.emoji || '📦';
  document.getElementById('d-loc').textContent = it.city || '—';
  document.getElementById('d-seller-sub').textContent =
    '平台认证卖家 · 👁 ' + (it.views || 0) + ' 次浏览';

  // Contact info
  const contactRow = document.getElementById('d-contact-row');
  const contactEl = document.getElementById('d-contact');
  const copyBtn = document.getElementById('d-copy-contact');
  if (it.contact && it.contact.trim()) {
    contactEl.textContent = it.contact.trim();
    contactRow.style.display = 'flex';
    copyBtn.onclick = () => {
      const txt = it.contact.trim();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(txt)
          .then(
            () => toast('已复制：' + txt),
            () => fallbackCopy(txt)
          );
      } else {
        fallbackCopy(txt);
      }
    };
  } else {
    contactRow.style.display = 'none';
  }

  // Meta tags
  const statusTag = it.status === 'sold'
    ? '<span style="background:#64748b;color:#fff">🏁 已售</span>'
    : '<span style="color:var(--ok)">在售</span>';
  document.getElementById('d-meta').innerHTML = [
    `<span>🏷 ${it.cat}</span>`,
    statusTag,
    `<span>👁 ${it.views || 0} 浏览</span>`,
    `<span>🕓 ${timeAgo(it.createdAt)}</span>`,
    `<span>#${it.id}</span>`,
  ].join('');

  // Gallery
  heroImgIdx = 0;
  const hero = document.getElementById('d-hero');
  const emojiEl = document.getElementById('d-emoji');
  const dots = document.getElementById('d-dots');

  if (it.images && it.images.length) {
    emojiEl.style.display = 'none';
    let img = hero.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      hero.insertBefore(img, hero.querySelector('.gallery-dots') || null);
    }
    img.decoding = 'async';
    img.src = it.images[0];
  } else {
    emojiEl.style.display = '';
    const old = hero.querySelector('img');
    if (old) old.remove();
    emojiEl.textContent = it.emoji || '📦';
  }

  dots.innerHTML =
    it.images && it.images.length
      ? it.images.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')
      : '';

  hero.onclick = (e) => {
    if (!it.images || !it.images.length) return;
    // 兼容 Pi Browser：同时检查 closest 和 tagName
    const tg = e.target.closest ? (e.target.closest('.back') || e.target.closest('.share')) : null;
    if (tg) return;
    // 额外检查：如果点击的是 button 元素，不触发图片切换
    if (e.target.tagName === 'BUTTON') return;
    heroImgIdx = (heroImgIdx + 1) % it.images.length;
    const img = hero.querySelector('img');
    if (img) img.src = it.images[heroImgIdx];
    dots.querySelectorAll('span').forEach((s, i) =>
      s.classList.toggle('on', i === heroImgIdx)
    );
  };

  // 返回按钮用 addEventListener，不依赖内联 onclick（Pi Browser 兼容）
  const backBtn = document.getElementById('detail-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      console.log('[detail] 返回按钮点击');
      goto('home');
    });
  }

  // 分享按钮
  const shareBtn = document.getElementById('detail-share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      openSheet('share');
    });
  }

  // Update buy button for sold items
  const fab = document.getElementById('d-fab');
  const buyBtn = fab.querySelector('.btn.primary');
  if (it.status === 'sold') {
    buyBtn.textContent = '🏁 已售出';
    buyBtn.disabled = true;
    buyBtn.style.opacity = '0.6';
  } else {
    buyBtn.textContent = '立即购买';
    buyBtn.disabled = false;
    buyBtn.style.opacity = '1';
  }
  fab.style.display = 'flex';
  drawFakeQR(id);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Navigate to order confirmation page.
 */
export function fakeBuy() {
  const id = state.currentDetailId;
  if (!id) { toast('请先选择商品'); return; }
  // Dynamic import to avoid circular dependency
  import('./order').then((mod) => mod.openOrder(id));
}

function drawFakeQR(id) {
  const canvas = document.getElementById('qrCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 21;
  const cell = Math.floor(96 / size);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 96, 96);
  ctx.fillStyle = '#111';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h = (h * 1103515245 + 12345) >>> 0;
      const on = h % 7 < 3;
      const inCorner =
        (x < 7 && y < 7) ||
        (x >= size - 7 && y < 7) ||
        (x < 7 && y >= size - 7);
      const cornerBorder =
        inCorner &&
        (x === 0 ||
          x === 6 ||
          y === 0 ||
          y === 6 ||
          x === size - 1 ||
          x === size - 7 ||
          y === size - 1 ||
          y === size - 7);
      const cornerInner =
        inCorner &&
        ((x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
          (x >= 2 && x <= 4 && y >= size - 5 && y <= size - 3) ||
          (x >= size - 5 && x <= size - 3 && y >= 2 && y <= 4));
      if (on || cornerBorder || cornerInner)
        ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // Show the item URL as text overlay
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 76, 96, 20);
  ctx.fillStyle = '#333';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('#ID: ' + id, 48, 88);

  // Bind click handler directly to canvas (instead of global document listener)
  canvas.onclick = () => {
    if (!state.currentDetailId) return;
    const link = `https://piflea.com/item/${state.currentDetailId}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => toast('已复制链接'));
    } else {
      fallbackCopy(link);
      toast('已复制链接到剪贴板');
    }
  };
}

/**
 * Open chat for the current detail item.
 */
export function openDetailChat() {
  const it = state.items.find((x) => x.id === state.currentDetailId);
  if (!it) return;
  const myIds = getAllMyUserIds();
  if (it.owner_id && myIds.includes(it.owner_id)) {
    toast('这是你自己的商品');
    return;
  }

  const me = getCurrentUserId();
  const other = it.owner_id || 'seller_' + (it.seller || 'unknown');
  const key = it.id + '|' + [me, other].sort().join('|');

  // Import dynamically to avoid circular dependency
  import('./chats').then((mod) => {
    mod.openChatByItem(it, other, key);
  });
}


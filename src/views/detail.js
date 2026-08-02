/* ============ Detail View ============ */

import { state } from '../main';
import { HIST_KEY } from '../state';
import { escapeHtml, fmtPrice, timeAgo, fallbackCopy, toast, getAllMyUserIds, getCurrentUserId } from '../utils';
import { openSheet } from '../components/sheet';
import { getSupabase } from '../supabase';

let heroImgIdx = 0;

/**
 * Bind detail view action buttons (idempotent via flags).
 * Replaces inline onclick handlers for Pi Browser compatibility.
 */
export function initDetailButtons() {
  const chatBtn = document.getElementById('d-chat-btn');
  if (chatBtn && !chatBtn._bound) {
    chatBtn._bound = true;
    chatBtn.addEventListener('click', openDetailChat);
  }
  const shareBtn = document.getElementById('d-share-btn');
  if (shareBtn && !shareBtn._bound) {
    shareBtn._bound = true;
    shareBtn.addEventListener('click', () => openSheet('share'));
  }
  const reportBtn = document.getElementById('d-report-btn');
  if (reportBtn && !reportBtn._bound) {
    reportBtn._bound = true;
    reportBtn.addEventListener('click', () => openSheet('report'));
  }
  const buyBtn = document.getElementById('d-buy-btn');
  if (buyBtn && !buyBtn._bound) {
    buyBtn._bound = true;
    buyBtn.addEventListener('click', fakeBuy);
  }
}

/**
 * Open detail view for an item.
 */
export async function openDetail(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) { toast('商品不存在'); return; }

  // 记录来源页，返回时回到该页（而非固定回首页）
  const activeView = document.querySelector('.view.active');
  const fromView = activeView ? activeView.id.replace('view-', '') : 'home';
  // 排除详情页自身（防止重复进入时来源被覆盖成 detail）
  if (fromView !== 'detail') {
    state.detailReturnTo = fromView;
  }

  // Bind action buttons (idempotent)
  initDetailButtons();

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
  document.getElementById('topSub').textContent = '平台担保交易 · 收货后放款';

  // Populate fields
  document.getElementById('d-title').textContent = it.title;
  document.getElementById('d-price').textContent = fmtPrice(it.price);
  document.getElementById('d-desc').textContent = it.desc || '（暂无描述）';
  document.getElementById('d-seller').textContent = it.seller || '卖家';
  document.getElementById('d-avatar').textContent = (it.seller || 'U').slice(0, 1);
  document.getElementById('d-emoji').textContent = it.emoji || '📦';
  document.getElementById('d-seller-sub').textContent = 'Pi 认证卖家';

  // 状态标签
  const statusTag = document.getElementById('d-status-tag');
  if (it.status === 'sold') {
    statusTag.textContent = '🏁 已售';
    statusTag.className = 'status-tag sold';
  } else {
    statusTag.textContent = '✓ 在售';
    statusTag.className = 'status-tag';
  }

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

  // Meta tags：城市/浏览/收藏/时间/分类（移除商品ID）
  const metaParts = [];
  if (it.city) metaParts.push(`<span>📍 ${escapeHtml(it.city)}</span>`);
  metaParts.push(`<span>👁 ${it.views || 0}</span>`);
  if (it.fav_count && it.fav_count > 0) metaParts.push(`<span>❤️ ${it.fav_count}</span>`);
  // 修复：created_at（蛇形）而非 createdAt（驼峰）
  if (it.created_at) {
    const ts = new Date(it.created_at).getTime();
    if (!isNaN(ts)) metaParts.push(`<span>🕒 ${timeAgo(ts)}</span>`);
  }
  if (it.cat) metaParts.push(`<span>🏷 ${escapeHtml(it.cat)}</span>`);
  document.getElementById('d-meta').innerHTML = metaParts.join('');

  // Gallery
  heroImgIdx = 0;
  const hero = document.getElementById('d-hero');
  const emojiEl = document.getElementById('d-emoji');
  const dots = document.getElementById('d-dots');

  // Build gallery container for swipe
  let gallery = hero.querySelector('.hero-gallery');
  if (!gallery) {
    gallery = document.createElement('div');
    gallery.className = 'hero-gallery';
    hero.insertBefore(gallery, hero.querySelector('.gallery-dots') || null);
  }

  if (it.images && it.images.length) {
    emojiEl.style.display = 'none';
    gallery.innerHTML = it.images.map((src, i) =>
      `<img src="${src}" decoding="async" style="min-width:100%;object-fit:cover;display:block" data-idx="${i}"/>`
    ).join('');
    gallery.style.display = 'flex';
    gallery.style.overflow = 'hidden';
    gallery.style.scrollSnapType = 'x mandatory';
    gallery.style.width = '100%';
    gallery.style.height = '100%';
    gallery.style.scrollBehavior = 'smooth';

    // Ensure each img has scroll-snap
    gallery.querySelectorAll('img').forEach(img => {
      img.style.scrollSnapAlign = 'start';
    });

    // Reset scroll
    gallery.scrollLeft = 0;
  } else {
    emojiEl.style.display = '';
    gallery.innerHTML = '';
    gallery.style.display = 'none';
    emojiEl.textContent = it.emoji || '📦';
  }

  dots.innerHTML =
    it.images && it.images.length
      ? it.images.map((_, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')
      : '';

  // 图片计数显示（如 2/5），无图时隐藏
  const countEl = document.getElementById('d-count');
  if (countEl) {
    if (it.images && it.images.length > 1) {
      countEl.style.display = '';
      countEl.textContent = '1/' + it.images.length;
    } else {
      countEl.style.display = 'none';
      countEl.textContent = '';
    }
  }

  // Update dots on scroll
  gallery.onscroll = () => {
    const idx = Math.round(gallery.scrollLeft / gallery.offsetWidth);
    if (idx !== heroImgIdx) {
      heroImgIdx = idx;
      dots.querySelectorAll('span').forEach((s, i) =>
        s.classList.toggle('on', i === heroImgIdx)
      );
      // 同步更新计数
      if (countEl && it.images && it.images.length) {
        countEl.textContent = (heroImgIdx + 1) + '/' + it.images.length;
      }
    }
  };

  // Click to go to next image (fallback when swipe doesn't work)
  hero.onclick = (e) => {
    if (!it.images || !it.images.length) return;
    const tg = e.target.closest ? (e.target.closest('.back') || e.target.closest('.share')) : null;
    if (tg) return;
    if (e.target.tagName === 'BUTTON') return;
    heroImgIdx = (heroImgIdx + 1) % it.images.length;
    gallery.scrollTo({ left: heroImgIdx * gallery.offsetWidth, behavior: 'smooth' });
  };

  // 返回按钮用 addEventListener，不依赖内联 onclick（Pi Browser 兼容）
  const backBtn = document.getElementById('detail-back-btn');
  if (backBtn && !backBtn._bound) {
    backBtn._bound = true;
    backBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      const target = state.detailReturnTo || 'home';
      goto(target);
      // 回到"我的"时，renderMine 会重置为概览页，需恢复之前的 tab（如"我的发布"）
      if (target === 'mine' && state.mineTab && state.mineTab !== 'overview') {
        import('../views/mine').then((mod) => mod.switchMine(state.mineTab));
      }
    });
  }

  // 分享按钮
  const shareBtn = document.getElementById('d-share-btn');
  if (shareBtn && !shareBtn._bound) {
    shareBtn._bound = true;
    shareBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      openSheet('share');
    });
  }

  // Update buy button for sold items
  const buyBtn = document.getElementById('d-buy-btn');
  if (it.status === 'sold') {
    buyBtn.textContent = '🏁 已售出';
    buyBtn.disabled = true;
    buyBtn.style.opacity = '0.6';
  } else {
    buyBtn.textContent = 'π 立即购买';
    buyBtn.disabled = false;
    buyBtn.style.opacity = '1';
  }
  document.getElementById('d-fab').style.display = 'flex';
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


﻿﻿﻿/* ============ Mine View (Personal Center) ============ */

import { state } from '../main';
import { HIST_KEY, DARK_KEY } from '../state';
import { escapeHtml, fmtPrice, toast, getOwnerId, getAllMyUserIds, getPiUid } from '../utils';
import { getSupabase, decodeItem } from '../supabase';
import { authenticateWithPi, logoutPi, isPiAuthenticated, getPiUser, createPiPayment } from '../pi-sdk';
import { goto } from '../router';
import { openEdit } from './publish';
import { openDetail } from './detail';
import { apiFetch, BACKEND_URL as BACKEND } from '../api';

// 用 addEventListener 绑定 tab 按钮（Pi Browser 不支持内联 onclick）
function initTabListeners() {
  const tabMap = { 'tab-post': 'post', 'tab-buy': 'buy', 'tab-sell': 'sell', 'tab-hist': 'hist' };
  Object.keys(tabMap).forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      // 移除之前可能绑定的事件（通过克隆节点）
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
      // 重新绑定事件
      newEl.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        switchMine(tabMap[id]);
      });
    }
  });
}

/**
 * Bind mine page buttons via addEventListener (idempotent via flags).
 * Replaces inline onclick handlers for Pi Browser compatibility.
 */
function initMineButtons() {
  // 深色模式切换：由 main.js 统一绑定（#darkToggle），此处不再重复绑定
  // 返回按钮
  const backBtn = document.getElementById('mine-back-btn');
  if (backBtn && !backBtn._bound) {
    backBtn._bound = true;
    backBtn.addEventListener('click', showMineOverview);
  }
  // Pi 账号按钮（登录/退出登录）
  const piBtn = document.getElementById('piAuthBtn');
  if (piBtn && !piBtn._bound) {
    piBtn._bound = true;
    piBtn.addEventListener('click', function() {
      const user = getPiUser();
      if (user) {
        piLogout();
      } else {
        piLogin();
      }
    });
  }
}

/**
 * Render the Mine page.
 */
export function renderMine() {
  initTabListeners();
  initMineButtons();
  initMineDelegation();

  // 显示 Pi 用户信息
  const user = getPiUser();
  if (user && user.username) {
    const av = document.getElementById('m-avatar');
    const nm = document.getElementById('m-name');
    if (av) av.textContent = (user.username || 'π').slice(0, 1).toUpperCase();
    if (nm) nm.textContent = '@' + user.username;
  }

  // 统计卡点击：跳转对应 tab（幂等绑定）
  const statsCard = document.getElementById('mine-stats');
  if (statsCard && !statsCard._bound) {
    statsCard._bound = true;
    statsCard.addEventListener('click', function(e) {
      const cell = e.target.closest('[data-stat]');
      if (!cell) return;
      const stat = cell.dataset.stat;
      if (stat === 'post') switchMine('post');
      else if (stat === 'buy') switchMine('buy');
      else if (stat === 'sell') switchMine('sell');
      else if (stat === 'fav') switchMine('fav');
    });
  }

  // 管理员入口：根据当前 Pi 登录 UID 自动显示/隐藏「运营后台」
  renderAdminEntry();

  // 默认显示概览页（不直接进入任何 tab）
  showMineOverview();
}

/**
 * 更新"我的"页面交易统计卡。
 * 发布商品：state.items 中属于当前用户的数量
 * 已购买：cachedOrders.buyer 长度（访问购买 tab 后缓存）
 * 已出售：cachedOrders.seller 长度（访问出售 tab 后缓存）
 * 暂无数据时显示 0。
 */
export function updateMineStats() {
  const postedEl = document.getElementById('stat-posted');
  const boughtEl = document.getElementById('stat-bought');
  const soldEl = document.getElementById('stat-sold');
  if (!postedEl) return;

  const myIds = getAllMyUserIds();
  const posted = state.items.filter((it) => it.owner_id && myIds.includes(it.owner_id)).length;
  const bought = (cachedOrders.buyer || []).length;
  const sold = (cachedOrders.seller || []).length;

  postedEl.textContent = posted;
  boughtEl.textContent = bought;
  soldEl.textContent = sold;
}

/**
 * Event delegation for mine-list & orderList (replaces inline onclick).
 * Idempotent via dataset.bound flag.
 */
export function initMineDelegation() {
  const list = document.getElementById('mine-list');
  if (list && !list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      const numId = Number(btn.dataset.id);
      if (action === 'edit') openEdit(numId);
      else if (action === 'markSold') markSold(numId);
      else if (action === 'unsetSold') unsetSold(numId);
      else if (action === 'deleteItem') deleteItem(numId);
      else if (action === 'openDetail') openDetail(numId);
    });
  }
  const orderList = document.getElementById('orderList');
  if (orderList && !orderList.dataset.bound) {
    orderList.dataset.bound = '1';
    orderList.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      const numId = Number(btn.dataset.id);
      if (action === 'completeOrder') completeOrder(numId);
      else if (action === 'markShipped') markShipped(numId);
      else if (action === 'gotoOrder') gotoOrderDetail(numId);
    });
  }
}

export function showMineOverview() {
  // 隐藏所有子页面内容
  const mineLoader = document.getElementById('mineLoader');
  const mineList = document.getElementById('mine-list');
  const mineEmpty = document.getElementById('mine-empty');
  const orderLoader = document.getElementById('orderLoader');
  const orderList = document.getElementById('orderList');
  const orderEmpty = document.getElementById('orderEmpty');

  if (mineLoader) mineLoader.style.display = 'none';
  if (mineList) mineList.style.display = 'none';
  if (mineEmpty) mineEmpty.style.display = 'none';
  if (orderLoader) orderLoader.style.display = 'none';
  if (orderList) orderList.style.display = 'none';
  if (orderEmpty) orderEmpty.style.display = 'none';

  // 显示概览元素
  const backBar = document.getElementById('mine-back-bar');
  const profile = document.getElementById('mine-profile');
  const stats = document.getElementById('mine-stats');
  const tabs = document.getElementById('mine-tabs');
  const setting = document.querySelector('#view-mine .setting');

  if (backBar) backBar.style.display = 'none';
  if (profile) profile.style.display = '';
  if (stats) stats.style.display = '';
  if (tabs) tabs.style.display = '';
  if (setting) setting.style.display = '';

  // 概览页刷新交易统计
  updateMineStats();
}

/**
 * Switch between 'post', 'buy', 'sell' and 'hist' tabs.
 */
export function switchMine(tab) {
  state.mineTab = tab;

  const mineLoader = document.getElementById('mineLoader');
  const mineList = document.getElementById('mine-list');
  const mineEmpty = document.getElementById('mine-empty');
  const orderLoader = document.getElementById('orderLoader');
  const orderList = document.getElementById('orderList');
  const orderEmpty = document.getElementById('orderEmpty');

  // 所有 tab 都进入子页面模式：隐藏概览信息，显示返回栏
  const backBar = document.getElementById('mine-back-bar');
  const profile = document.getElementById('mine-profile');
  const stats = document.getElementById('mine-stats');
  const tabs = document.getElementById('mine-tabs');
  const setting = document.querySelector('#view-mine .setting');
  const backTitle = document.getElementById('mine-back-title');

  if (backBar) backBar.style.display = 'flex';
  if (profile) profile.style.display = 'none';
  if (stats) stats.style.display = 'none';
  if (tabs) tabs.style.display = 'none';
  if (setting) setting.style.display = 'none';
  if (backTitle) {
    const titleMap = { post: '我的发布', buy: '我的购买', sell: '我的出售', fav: '我的收藏', hist: '浏览记录' };
    backTitle.textContent = titleMap[tab] || '我的';
  }

  if (tab === 'buy' || tab === 'sell') {
    // 显示订单相关容器，隐藏我的发布/浏览记录容器
    mineLoader.style.display = 'none';
    mineList.style.display = 'none';
    mineEmpty.style.display = 'none';
    orderList.style.display = 'block';
    loadOrders(tab === 'buy' ? 'buyer' : 'seller');
    return;
  }

  // 非订单 tab：隐藏订单容器，显示我的列表容器
  orderLoader.style.display = 'none';
  orderList.style.display = 'none';
  orderEmpty.style.display = 'none';
  mineList.style.display = 'block';

  const loader = mineLoader;
  const list = mineList;
  const empty = mineEmpty;

  loader.style.display = 'none';

  if (tab === 'post') {
    const myIds = getAllMyUserIds();
    const filtered = state.items.filter(
      (it) =>
        (it.owner_id && myIds.includes(it.owner_id))
    );

    if (filtered.length) {
      empty.style.display = 'none';
      list.innerHTML = filtered
        .map(
          (it) =>
            `<div class="row-item" data-action="openDetail" data-id="${it.id}">
              <div class="pic">${
                it.images && it.images[0]
                  ? `<img src="${it.images[0]}" loading="lazy" decoding="async" onerror="this.style.display='none'"/>`
                  : it.emoji
              }</div>
              <div class="txt">
                <h4>${escapeHtml(it.title)} ${it.status === 'sold' ? '<span class="mini" style="color:#64748b">已售</span>' : it.status === 'pending' ? '<span class="mini" style="color:#f59e0b">交易中</span>' : '<span class="mini" style="color:var(--ok)">在售</span>'}</h4>
                <div class="price">${fmtPrice(it.price)} π</div>
                <div class="sub">📂 ${it.category || ''} · 👁 ${it.views || 0} · ♥ ${it.fav_count || 0} · 📅 ${it.created_at ? new Date(it.created_at).toLocaleDateString() : ''}</div>
              </div>
              <div class="row-actions">
                <button class="edit-btn" data-action="edit" data-id="${it.id}">编辑</button>
                ${it.status === 'sold'
                  ? `<button class="rm" data-action="unsetSold" data-id="${it.id}">恢复在售</button>`
                  : it.status === 'pending'
                  ? ''
                  : `<button class="edit-btn" data-action="markSold" data-id="${it.id}">标记已售</button>`
                }
                <button class="rm" data-action="deleteItem" data-id="${it.id}">删除</button>
              </div>
            </div>`
        )
        .join('');
    } else {
      list.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = '还没有发布过商品，快去发布一件吧～';
    }
  } else if (tab === 'fav') {
    // 我的收藏：从后端 /api/favorites 拉取（需 Pi 登录）
    loadFavorites(list, empty);
  } else if (tab === 'hist') {
    const viewed = state.history
      .map((h) => state.items.find((it) => it.id === h.id))
      .filter(Boolean);
    if (viewed.length) {
      empty.style.display = 'none';
      list.innerHTML = viewed
        .map(
          (it) =>
            `<div class="row-item" data-action="openDetail" data-id="${it.id}">
              <div class="pic">${
                it.images && it.images[0]
                  ? `<img src="${it.images[0]}" loading="lazy" decoding="async" onerror="this.style.display='none'"/>`
                  : it.emoji
              }</div>
              <div class="txt">
                <h4>${escapeHtml(it.title)}</h4>
                <div class="price">${fmtPrice(it.price)} π</div>
                <div class="sub">${escapeHtml(it.cat || '')}</div>
              </div>
            </div>`
        )
        .join('');
    } else {
      list.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = '还没有浏览记录～';
    }
  }
}

/**
 * 加载我的收藏列表（从后端 /api/favorites 拉取，需 Pi 登录）。
 * 后端返回 items 原始行，直接渲染。
 */
async function loadFavorites(list, empty) {
  if (!getPiUser()) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = '请先登录 Pi 账号后查看收藏～';
    return;
  }
  try {
    const res = await apiFetch('/api/favorites');
    const data = await res.json();
    if (!res.ok || !data.success) {
      list.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = data.error || '加载收藏失败';
      return;
    }
    const items = data.data || [];
    if (!items.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = '还没有收藏商品，去逛逛吧～';
      return;
    }
    empty.style.display = 'none';
    // decode 后注入 state.items（去重），保证 openDetail 能找到商品
    const decoded = items.map((raw) => decodeItem(raw));
    decoded.forEach((it) => {
      if (it && !state.items.find((x) => String(x.id) === String(it.id))) {
        state.items.push(it);
      }
    });
    list.innerHTML = decoded
      .map((it) => {
        const img = it.images && it.images[0]
          ? `<img src="${it.images[0]}" loading="lazy" decoding="async" onerror="this.style.display='none'"/>`
          : (it.emoji || '📦');
        const statusBadge = it.status === 'sold'
          ? '<span class="mini" style="color:#64748b">已售</span>'
          : '<span class="mini" style="color:var(--ok)">在售</span>';
        return `<div class="row-item" data-action="openDetail" data-id="${it.id}">
          <div class="pic">${img}</div>
          <div class="txt">
            <h4>${escapeHtml(it.title || '')} ${statusBadge}</h4>
            <div class="price">${fmtPrice(it.price)} π</div>
            <div class="sub">📂 ${it.cat || ''} · 👁 ${it.views || 0} · 📅 ${it.createdAt ? new Date(it.createdAt).toLocaleDateString() : ''}</div>
          </div>
        </div>`;
      })
      .join('');
  } catch (e) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = '网络错误：' + (e?.message || e);
  }
}

/**
 * Toggle admin mode (5 clicks).
 */
export function toggleAdmin() {
  state.adminClicks++;
  localStorage.setItem('pi_flea_admin_clicks', state.adminClicks.toString());
  if (state.adminClicks >= 5) {
    state.admin = 1;
    localStorage.setItem('pi_flea_admin_v3', '1');
    toast('✅ 运营后台已解锁');
    goto('admin');
  }
}

/**
 * 前端管理员 UID 白名单（与 backend-worker.js 的 ADMIN_UIDS 保持一致）。
 * 用于在「我的」页面自动显示「运营后台」入口。
 */
const ADMIN_UIDS = ['b0e1ca76-fa58-409f-a79c-60eab2a52250'];

/**
 * 判断当前 Pi 登录用户是否为管理员。
 */
export function isAdminUser() {
  const u = getPiUser();
  return !!(u && u.uid && ADMIN_UIDS.includes(u.uid));
}

/**
 * 渲染「运营后台」入口到「我的」页面的 setting-links 区。
 * 仅管理员可见；非管理员或未登录时移除入口。
 * 幂等：通过 id 复用，重复调用安全。
 */
export function renderAdminEntry() {
  const box = document.querySelector('#view-mine .setting-links');
  if (!box) return;

  // 移除可能已存在的入口
  const old = document.getElementById('link-admin');
  if (old) old.remove();

  if (!isAdminUser()) {
    // 非管理员：确保 state.admin 不被白名单外用户污染
    return;
  }

  // 管理员：设置 state.admin，允许进入 admin 页面
  state.admin = 1;
  localStorage.setItem('pi_flea_admin_v3', '1');

  const row = document.createElement('div');
  row.className = 'srow link';
  row.id = 'link-admin';
  row.innerHTML = '<div class="lb">🛠 运营后台</div><span class="arrow">›</span>';
  if (!row._bound) {
    row._bound = true;
    row.addEventListener('click', function() { goto('admin'); });
  }
  // 插到 setting-links 最前面，便于管理员快速访问
  box.insertBefore(row, box.firstChild);
}

/**
 * Pi login handler.
 */
export async function piLogin() {
  const user = await authenticateWithPi();
  if (user) {
    applyPiUser();
    // 登录成功后立即加载订单
    loadOrders('buyer');
    loadOrders('seller');
  }
}

/**
 * Pi logout handler.
 */
export function piLogout() {
  if (!confirm('确定要退出 Pi 登录吗？')) return;
  logoutPi();
  const av = document.getElementById('m-avatar');
  const nm = document.getElementById('m-name');
  const id = document.getElementById('m-id');
  if (av) av.textContent = 'π';
  if (nm) nm.textContent = '未登录';
  if (id) id.textContent = '未登录';
  updatePiButtonState();
  // 退出后移除管理员入口
  renderAdminEntry();
}

/**
 * Apply Pi user info to UI.
 */
export function applyPiUser() {
  const user = getPiUser();
  if (!user) return;
  const username = user.username || ('pi_' + (user.uid || '').slice(0, 8));
  const av = document.getElementById('m-avatar');
  const nm = document.getElementById('m-name');
  const id = document.getElementById('m-id');
  if (nm) nm.textContent = '@' + username;
  if (av) av.textContent = (user.username || 'π').slice(0, 1).toUpperCase();
  if (id) id.textContent = 'UID: ' + (user.uid || '');
  // Reload items to reflect Pi UID ownership
  import('../views/home').then(mod => mod.loadItems());
  updatePiButtonState();
  // 登录态变化后同步管理员入口
  renderAdminEntry();
}

/**
 * Update Pi auth button state.
 */
export function updatePiButtonState() {
  const el = document.getElementById('piAuthBtn');
  if (!el) return;

  const user = getPiUser();

  if (user && user.username) {
    el.textContent = '退出登录';
    el.style.color = 'var(--ink-2)';
  } else {
    el.textContent = '登录 Pi 账号';
    el.style.color = 'var(--brand)';
  }

  // 同步顶部头像：登录显示首字母 + 品牌色背景，未登录显示 👤 + 灰色
  updateTopAvatar();
}

/**
 * 同步顶部头像显示。
 */
export function updateTopAvatar() {
  const av = document.getElementById('topAvatar');
  if (!av) return;
  const user = getPiUser();
  if (user && user.username) {
    av.textContent = (user.username).slice(0, 1).toUpperCase();
    av.classList.add('logged-in');
  } else {
    av.textContent = '👤';
    av.classList.remove('logged-in');
  }
}

/**
 * Pi payment test handler.
 */
export function piPayTest() {
  const btn = document.getElementById('piPayTestBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '支付中...';
  }

  createPiPayment(0.01, 'Pi Flea Market payment test', { test: true })
    .catch(() => {
      // Error handled by createPiPayment
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '支付 0.01π';
      }
    });
}

/**
 * Mark an item as sold.
 */
export async function markSold(id) {
  if (!confirm('标记为已售？商品将从首页下架')) return;
  try {
    const res = await apiFetch('/api/items/mark-sold', {
      method: 'POST',
      body: JSON.stringify({ itemId: id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '请求失败');
    }
    const it = state.items.find(x => x.id === id);
    if (it) it.status = 'sold';
    toast('✅ 已标记为已售');
    updateMineStats();
    switchMine('post');
  } catch (e) {
    toast('操作失败：' + e.message);
  }
}

/**
 * Revert a sold item back to active.
 */
export async function unsetSold(id) {
  try {
    const res = await apiFetch('/api/items/unset-sold', {
      method: 'POST',
      body: JSON.stringify({ itemId: id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '请求失败');
    }
    const it = state.items.find(x => x.id === id);
    if (it) it.status = 'active';
    toast('✅ 已恢复在售');
    updateMineStats();
    switchMine('post');
  } catch (e) {
    toast('操作失败：' + e.message);
  }
}

/**
 * Delete an item permanently.
 */
export async function deleteItem(id) {
  if (!confirm('确定删除该商品？\n删除后不可恢复，相关订单不受影响。')) return;
  try {
    const res = await apiFetch('/api/items/delete', {
      method: 'POST',
      body: JSON.stringify({ itemId: id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '请求失败');
    }
    // 从本地 state 移除
    const idx = state.items.findIndex((x) => x.id === id);
    if (idx >= 0) state.items.splice(idx, 1);
    toast('✅ 已删除');
    updateMineStats();
    switchMine('post');
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

/**
 * Export app data.
 */

let cachedOrders = { buyer: [], seller: [] };
let currentOrderRole = null;

export async function loadOrders(role) {
  const orderLoader = document.getElementById('orderLoader');
  const orderList = document.getElementById('orderList');
  const orderEmpty = document.getElementById('orderEmpty');

  // 只有当前在订单 tab 才显示加载
  const activeTab = state.mineTab;
  if (activeTab !== 'buy' && activeTab !== 'sell') {
    return;
  }

  orderLoader.style.display = 'block';
  orderList.innerHTML = '';
  orderEmpty.style.display = 'none';

  const user = getPiUser();
  if (!user) {
    orderLoader.style.display = 'none';
    orderEmpty.style.display = 'block';
    orderEmpty.textContent = '请先登录 Pi 账号';
    return;
  }

  try {
    const res = await apiFetch('/api/my-orders?uid=' + encodeURIComponent(user.uid) + '&role=' + role);
    const json = await res.json();
    orderLoader.style.display = 'none';

    if (!res.ok || !json.success) {
      orderEmpty.style.display = 'block';
      orderEmpty.textContent = json.message || '加载订单失败';
      return;
    }

    const orders = json.data || [];

    if (orders.length === 0) {
      orderEmpty.style.display = 'block';
      orderEmpty.textContent = role === 'buyer' ? '还没有购买记录' : '还没有卖出记录';
      return;
    }

    const statusMap = { 'pending': '处理中', 'approved': '支付中', 'paid': '待发货', 'paid_pending_transfer': '待转账', 'shipped': '已发货', 'completed': '已完成' };

    // 缓存订单数据，详情页使用
    cachedOrders[role] = orders;
    // 订单缓存更新后刷新交易统计
    updateMineStats();

    orderList.innerHTML = orders.map(function(o) {
      return '<div class="row-item" data-action="gotoOrder" data-id="' + o.id + '" style="cursor:pointer">' +
        '<div class="pic" style="background:var(--bg);display:grid;place-items:center;font-size:28px;color:#b8bfd1">' +
          '\ud83d\udce6' +
        '</div>' +
        '<div class="txt">' +
          '<h4>' + (o.item_title || '商品') + '</h4>' +
          '<div class="price">' + (o.item_price || o.amount || 0) + ' \u03c0</div>' +
          '<div class="sub">' + (o.order_no || '#' + o.id) + ' \u00b7 ' + (statusMap[o.status] || o.status) + ' \u00b7 ' + new Date(o.created_at).toLocaleDateString() + (o.status === 'shipped' && o.shipping_company ? ' \u00b7 ' + o.shipping_company : '') + '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          (role === 'buyer' && o.status === 'shipped'
            ? '<button class="edit-btn" data-action="completeOrder" data-id="' + o.id + '">确认收货</button>'
            : '') +
          (role === 'seller' && o.status === 'paid'
            ? '<button class="edit-btn" data-action="markShipped" data-id="' + o.id + '">标记发货</button>'
            : '') +
          (o.status === 'completed' ? '<span class="mini" style="color:var(--ok);font-size:12px">\u2714 \u5df2\u5b8c\u6210</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    orderLoader.style.display = 'none';
    orderEmpty.style.display = 'block';
    orderEmpty.textContent = '加载失败：' + e.message;
  }
}

export function gotoOrderDetail(orderId) {
  const role = state.mineTab === 'buy' ? 'buyer' : 'seller';
  const orders = cachedOrders[role] || [];
  const order = orders.find((o) => String(o.id) === String(orderId));
  if (!order) {
    toast('订单信息不存在');
    return;
  }
  currentOrderRole = role;

  const statusMap = { 'paid': '待发货', 'paid_pending_transfer': '待转账', 'shipped': '已发货', 'completed': '已完成' };
  const isBuyer = role === 'buyer';
  const otherLabel = isBuyer ? '卖家' : '买家';
  const otherUid = isBuyer ? (order.seller_uid || order.seller_id || '—') : (order.buyer_uid || order.buyer_id || '—');

  // 通过 product_id 关联商品信息
  const item = order.product_id ? state.items.find((it) => String(it.id) === String(order.product_id)) : null;
  const itemImage = item?.images?.[0] || '';
  const itemDesc = item?.description || '';

  const html =
    '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">📦 商品信息</div>' +
      (itemImage ? '<div style="margin-bottom:10px"><img src="' + itemImage + '" style="width:100%;max-height:180px;object-fit:cover;border-radius:8px" onerror="this.style.display=\'none\'"/></div>' : '') +
      '<div style="font-size:15px;font-weight:600">' + (order.item_title || '商品') + '</div>' +
      (itemDesc ? '<div style="color:var(--ink-2);font-size:13px;margin-top:4px;line-height:1.5">' + escapeHtml(itemDesc) + '</div>' : '') +
      '<div style="color:var(--ink-2);font-size:13px;margin-top:4px">单价：' + (order.item_price || order.amount || 0) + ' π</div>' +
    '</div>' +
    '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">📋 订单状态</div>' +
      '<div style="font-size:16px;font-weight:700;color:var(--brand)">' + (statusMap[order.status] || order.status) + '</div>' +
      '<div style="color:var(--ink-2);font-size:12px;margin-top:4px">订单号：' + (order.order_no || '#' + order.id) + '</div>' +
      '<div style="color:var(--ink-2);font-size:12px">创建时间：' + new Date(order.created_at).toLocaleString() + '</div>' +
      (order.txid ? '<div style="color:var(--ink-2);font-size:12px;margin-top:4px">交易哈希：' + order.txid + '</div>' : '') +
    '</div>' +
    '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">💰 金额明细</div>' +
      '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span>商品金额</span><span>' + (order.item_price || order.amount || 0) + ' π</span></div>' +
      '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span>平台服务费</span><span style="color:var(--ok)">0.00 π 限时免费</span></div>' +
      '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:14px"><span>区块链网络费</span><span style="color:var(--ok)">Pi网络收取（以钱包显示为准）</span></div>' +
      '<hr style="border:none;border-top:1px dashed var(--line);margin:8px 0">' +
      '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:16px;font-weight:700"><span>实付金额</span><span style="color:var(--brand)">' + (order.amount || order.item_price || 0) + ' π</span></div>' +
    '</div>' +
    '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">👤 交易对方</div>' +
      '<div style="font-size:14px">' + otherLabel + 'UID：' + (otherUid.length > 16 ? otherUid.slice(0, 16) + '...' : otherUid) + '</div>' +
    '</div>' +
    (order.shipping_company || order.tracking_no
      ? '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:10px">📦 物流信息</div>' +
        '<div style="font-size:14px;margin-bottom:4px">快递公司：' + (order.shipping_company || '—') + '</div>' +
        '<div style="font-size:14px;margin-bottom:8px">快递单号：' + (order.tracking_no || '—') + '</div>' +
        (order.tracking_no
          ? '<a href="https://www.kuaidi100.com/chaxun?nu=' + encodeURIComponent(order.tracking_no) + '" target="_blank" style="font-size:13px;color:var(--brand);">查看物流轨迹 →</a>'
          : '') +
        '</div>'
      : '') +
    '<div style="padding:10px 0">' +
      (isBuyer && order.status === 'shipped'
        ? '<button class="btn primary" data-action="completeOrder" data-id="' + order.id + '" style="width:100%;padding:14px">确认收货</button>'
        : '') +
      (!isBuyer && order.status === 'paid'
        ? '<button class="btn primary" data-action="markShipped" data-id="' + order.id + '" style="width:100%;padding:14px">标记发货</button>'
        : '') +
      (order.status === 'completed' ? '<div style="text-align:center;color:var(--ok);font-size:14px">✔ 交易已完成</div>' : '') +
    '</div>';

  const content = document.getElementById('od-content');
  if (content) content.innerHTML = html;

  goto('order-detail');

  // 订单详情按钮事件委托（替换内联 onclick，兼容 Pi Browser）
  const odContent = document.getElementById('od-content');
  if (odContent && !odContent.dataset.bound) {
    odContent.dataset.bound = '1';
    odContent.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      const numId = Number(btn.dataset.id);
      if (action === 'completeOrder') completeOrder(numId);
      else if (action === 'markShipped') markShipped(numId);
    });
  }
}

export async function completeOrder(orderId) {
  const user = getPiUser();
  if (!user) { toast('请先登录'); return; }
  if (!confirm('确认已收到商品？\n确认后平台将自动把 Pi 转给卖家。')) return;
  try {
    toast('正在确认收货并转账给卖家...');
    const res = await apiFetch('/api/transfer-to-seller', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, buyer_id: user.uid })
    });
    const json = await res.json();
    if (json.success) {
      toast('确认收货成功！Pi 已自动转给卖家');
      loadOrders('buyer');
    } else {
      toast('操作失败：' + (json.message || json.error || '未知错误'));
    }
  } catch (e) { toast('请求失败：' + e.message); }
}

export async function markShipped(orderId) {
  const user = getPiUser();
  if (!user) { toast('请先登录'); return; }

  // 弹出发货弹窗
  showShipModal(orderId, user);
}

function showShipModal(orderId, user) {
  const old = document.getElementById('ship-modal');
  if (old) old.remove();

  const companies = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '申通快递', '百世快递', '邮政EMS', '京东物流', '极兔速递', '其他/自送'];

  const modal = document.createElement('div');
  modal.id = 'ship-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
  modal.innerHTML = `
    <div style="background:var(--card,#fff);border-radius:16px;padding:24px 20px;max-width:340px;width:88%;">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px;">📦 填写发货信息</div>
      <div style="margin-bottom:14px;">
        <label style="font-size:13px;color:var(--ink-2);display:block;margin-bottom:6px;">快递公司</label>
        <select id="ship-company" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:var(--card);">
          ${companies.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:13px;color:var(--ink-2);display:block;margin-bottom:6px;">快递单号</label>
        <input id="ship-tracking" type="text" placeholder="请输入快递单号" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </div>
      <div style="display:flex;gap:10px;">
        <button id="ship-cancel" style="flex:1;padding:12px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:transparent;cursor:pointer;">取消</button>
        <button id="ship-confirm" style="flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;background:var(--brand);color:#fff;cursor:pointer;">确认发货</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#ship-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#ship-confirm').addEventListener('click', async () => {
    const company = document.getElementById('ship-company').value;
    const trackingNo = document.getElementById('ship-tracking').value.trim();
    modal.remove();

    try {
      toast('正在提交发货信息...');
      const res = await apiFetch('/api/mark-shipped', {
        method: 'POST',
        body: JSON.stringify({ order_id: orderId, seller_id: user.uid, shipping_company: company, tracking_no: trackingNo })
      });
      const json = await res.json();
      if (json.success) { toast('已标记发货！' + (trackingNo ? '物流：' + company + ' ' + trackingNo : '')); loadOrders('seller'); }
      else { toast('操作失败：' + (json.message || json.error || '未知错误')); }
    } catch (e) { toast('请求失败：' + e.message); }
  });
}

export function exportData() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          items: state.items,
          chats: state.chats,
          history: state.history,
        },
        null,
        2
      ),
    ],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pi-flea-data.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  toast('已导出数据');
}


﻿﻿﻿/* ============ Mine View (Personal Center) ============ */

import { state } from '../main';
import { HIST_KEY, DARK_KEY } from '../state';
import { escapeHtml, fmtPrice, toast, getOwnerId, getAllMyUserIds, getPiUid } from '../utils';
import { getSupabase } from '../supabase';
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
        console.log('[mine] tab点击:', tabMap[id]);
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
  // Pi 账号行（根据登录状态决定 piLogin / piLogout）
  const piText = document.getElementById('piAuthText');
  if (piText && !piText._bound) {
    piText._bound = true;
    piText.addEventListener('click', function() {
      const user = getPiUser();
      if (user) {
        piLogout();
      } else if (typeof window.Pi !== 'undefined') {
        piLogin();
      } else {
        toast('请下载 Pi Browser App 访问本网站');
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

  // Counts
  const myIds = getAllMyUserIds();
  const myItems = state.items.filter(
    (it) =>
      (it.owner_id && myIds.includes(it.owner_id))
  );

  // 默认显示概览页（不直接进入任何 tab）
  showMineOverview();
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
  const wallet = document.getElementById('mine-wallet');
  const tabs = document.getElementById('mine-tabs');
  const setting = document.querySelector('#view-mine .setting');

  if (backBar) backBar.style.display = 'none';
  if (profile) profile.style.display = '';
  if (wallet) wallet.style.display = '';
  if (tabs) tabs.style.display = '';
  if (setting) setting.style.display = '';
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
  const wallet = document.getElementById('mine-wallet');
  const tabs = document.getElementById('mine-tabs');
  const setting = document.querySelector('#view-mine .setting');
  const backTitle = document.getElementById('mine-back-title');

  if (backBar) backBar.style.display = 'flex';
  if (profile) profile.style.display = 'none';
  if (wallet) wallet.style.display = 'none';
  if (tabs) tabs.style.display = 'none';
  if (setting) setting.style.display = 'none';
  if (backTitle) {
    const titleMap = { post: '我的发布', buy: '我的购买', sell: '我的出售', hist: '浏览记录' };
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
                <h4>${escapeHtml(it.title)} ${it.status === 'sold' ? '<span class="mini" style="color:#64748b">已售</span>' : '<span class="mini" style="color:var(--ok)">在售</span>'}</h4>
                <div class="price">${fmtPrice(it.price)} π</div>
                <div class="sub">👁 ${it.views || 0} 浏览</div>
              </div>
              <div class="row-actions">
                <button class="edit-btn" data-action="edit" data-id="${it.id}">编辑</button>
                ${it.status === 'sold'
                  ? `<button class="rm" data-action="unsetSold" data-id="${it.id}">恢复在售</button>`
                  : `<button class="edit-btn" data-action="markSold" data-id="${it.id}">标记已售</button>`
                }
              </div>
            </div>`
        )
        .join('');
    } else {
      list.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = '还没有发布过商品，快去发布一件吧～';
    }
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
  if (id) id.textContent = 'UID: ' + (user.uid || '').slice(0, 16);
  // Reload items to reflect Pi UID ownership
  import('../views/home').then(mod => mod.loadItems());
  updatePiButtonState();
}

/**
 * Update Pi auth button state.
 */
export function updatePiButtonState() {
  const el = document.getElementById('piAuthText');
  if (!el) return;

  const user = getPiUser();
  const hasPi = typeof window.Pi !== 'undefined';

  if (user && user.username) {
    el.textContent = '@' + user.username;
    el.style.color = 'var(--ok)';
  } else if (hasPi) {
    el.textContent = '点击登录';
    el.style.color = 'var(--brand)';
  } else {
    el.textContent = '请在Pi浏览器中打开';
    el.style.color = 'var(--ink-2)';
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
    const supabase = getSupabase();
    const { error } = await supabase.from('items').update({ status: 'sold' }).eq('id', id);
    if (error) throw error;
    const it = state.items.find(x => x.id === id);
    if (it) it.status = 'sold';
    toast('✅ 已标记为已售');
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
    const supabase = getSupabase();
    const { error } = await supabase.from('items').update({ status: 'active' }).eq('id', id);
    if (error) throw error;
    const it = state.items.find(x => x.id === id);
    if (it) it.status = 'active';
    toast('✅ 已恢复在售');
    switchMine('post');
  } catch (e) {
    toast('操作失败：' + e.message);
  }
}

/**
 * Export app data.
 */

let cachedOrders = { buyer: [], seller: [] };
let currentOrderRole = null;

export async function loadOrders(role) {
  console.log('[loadOrders] role=', role);
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
    const orders = json.data || [];

    if (orders.length === 0) {
      orderEmpty.style.display = 'block';
      orderEmpty.textContent = role === 'buyer' ? '还没有购买记录' : '还没有卖出记录';
      return;
    }

    const statusMap = { 'approved': '支付中', 'paid': '待发货', 'paid_pending_transfer': '待转账', 'shipped': '已发货', 'completed': '已完成' };

    // 缓存订单数据，详情页使用
    cachedOrders[role] = orders;

    orderList.innerHTML = orders.map(function(o) {
      console.log('[renderOrders] orderId=', o.id, 'title=', o.item_title);
      return '<div class="row-item" data-action="gotoOrder" data-id="' + o.id + '" style="cursor:pointer">' +
        '<div class="pic" style="background:var(--bg);display:grid;place-items:center;font-size:28px;color:#b8bfd1">' +
          '\ud83d\udce6' +
        '</div>' +
        '<div class="txt">' +
          '<h4>' + (o.item_title || '商品') + '</h4>' +
          '<div class="price">' + (o.item_price || o.amount || 0) + ' \u03c0</div>' +
          '<div class="sub">' + (statusMap[o.status] || o.status) + ' \u00b7 ' + new Date(o.created_at).toLocaleDateString() + (o.status === 'shipped' && o.shipping_company ? ' \u00b7 ' + o.shipping_company : '') + '</div>' +
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
  console.log('[gotoOrderDetail] orderId=', orderId);
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

  const html =
    '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">📦 商品信息</div>' +
      '<div style="font-size:15px;font-weight:600">' + (order.item_title || '商品') + '</div>' +
      '<div style="color:var(--ink-2);font-size:13px;margin-top:4px">单价：' + (order.item_price || order.amount || 0) + ' π</div>' +
    '</div>' +
    '<div style="background:var(--card);border-radius:var(--radius);padding:14px;box-shadow:var(--shadow);margin-bottom:12px">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:10px">📋 订单状态</div>' +
      '<div style="font-size:16px;font-weight:700;color:var(--brand)">' + (statusMap[order.status] || order.status) + '</div>' +
      '<div style="color:var(--ink-2);font-size:12px;margin-top:4px">订单号：' + (order.id) + '</div>' +
      '<div style="color:var(--ink-2);font-size:12px">创建时间：' + new Date(order.created_at).toLocaleString() + '</div>' +
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
  showShipModal(orderId);
}

function showShipModal(orderId) {
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
        <input id="ship-tracking" type="text" placeholder="请输入快递单号（选填）" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;font-size:14px;box-sizing:border-box;" />
      </div>
      <div style="display:flex;gap:10px;">
        <button id="ship-cancel" style="flex:1;padding:12px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:transparent;cursor:pointer;">取消</button>
        <button id="ship-confirm" style="flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;background:var(--primary);color:#fff;cursor:pointer;">确认发货</button>
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


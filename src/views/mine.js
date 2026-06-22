/* ============ Mine View (Personal Center) ============ */

import { state } from '../main';
import { HIST_KEY, DARK_KEY } from '../state';
import { escapeHtml, fmtPrice, toast, getOwnerId, getAllMyUserIds, getPiUid } from '../utils';
import { getSupabase } from '../supabase';
import { authenticateWithPi, logoutPi, isPiAuthenticated, getPiUser, createPiPayment } from '../pi-sdk';
import { goto } from '../router';
import { openEdit } from './publish';

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
 * Render the Mine page.
 */
export function renderMine() {
  initTabListeners();
  const me = localStorage.getItem('pi_flea_me') || '本地用户';
  document.getElementById('m-name').textContent = me;
  document.getElementById('m-avatar').textContent = me.slice(0, 1);

  // Counts
  const myIds = getAllMyUserIds();
  const myItems = state.items.filter(
    (it) =>
      (it.owner_id && myIds.includes(it.owner_id)) ||
      (it.seller || '') === me
  );
  const totalViews = myItems.reduce((sum, it) => sum + (it.views || 0), 0);

  document.getElementById('m-post').textContent = myItems.length;
  document.getElementById('m-view').textContent = totalViews;

  // Pi wallet (placeholder)
  document.getElementById('m-pi').textContent = isPiAuthenticated()
    ? '∞'
    : '100.0';

  // Tab
  switchMine(state.mineTab || 'post');
}

/**
 * Switch between 'post', 'buy', 'sell' and 'hist' tabs.
 */
export function switchMine(tab) {
  state.mineTab = tab;
  document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('on'));
  document.getElementById('tab-' + tab)?.classList.add('on');

  const mineLoader = document.getElementById('mineLoader');
  const mineList = document.getElementById('mine-list');
  const mineEmpty = document.getElementById('mine-empty');
  const orderLoader = document.getElementById('orderLoader');
  const orderList = document.getElementById('orderList');
  const orderEmpty = document.getElementById('orderEmpty');

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
    const me = localStorage.getItem('pi_flea_me') || '';
    const myIds = getAllMyUserIds();
    const filtered = state.items.filter(
      (it) =>
        (it.owner_id && myIds.includes(it.owner_id)) ||
        (!it.owner_id && (it.seller || '') === me)
    );

    if (filtered.length) {
      empty.style.display = 'none';
      list.innerHTML = filtered
        .map(
          (it) =>
            `<div class="row-item" onclick="window.openDetail(${it.id})">
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
                <button class="edit-btn" onclick="event.stopPropagation();window.openEdit(${it.id})">编辑</button>
                ${it.status === 'sold'
                  ? `<button class="rm" onclick="event.stopPropagation();window.unsetSold(${it.id})">恢复在售</button>`
                  : `<button class="edit-btn" onclick="event.stopPropagation();window.markSold(${it.id})">标记已售</button>`
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
            `<div class="row-item" onclick="window.openDetail(${it.id})">
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
 * Edit user nickname.
 */
const NAME_EDIT_COOLDOWN = 24 * 60 * 60 * 1000;
const NAME_EDIT_TIME_KEY = 'pi_flea_name_edit_at';

export function editMyName() {
  const current = localStorage.getItem('pi_flea_me') || '';
  const lastEdit = parseInt(localStorage.getItem(NAME_EDIT_TIME_KEY) || '0', 10);
  const now = Date.now();
  if (lastEdit && now - lastEdit < NAME_EDIT_COOLDOWN) {
    const hours = Math.ceil((NAME_EDIT_COOLDOWN - (now - lastEdit)) / 3600000);
    toast('昵称每24小时可修改一次，剩余 ' + hours + ' 小时');
    return;
  }
  const name = prompt('请输入你的昵称（显示在商品页）', current);
  if (name && name.trim()) {
    localStorage.setItem('pi_flea_me', name.trim());
    localStorage.setItem(NAME_EDIT_TIME_KEY, String(now));
    renderMine();
    toast('昵称已更新');
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
  const me = localStorage.getItem('pi_flea_me') || '本地用户';
  document.getElementById('m-name').textContent = me;
  document.getElementById('m-avatar').textContent = me.slice(0, 1);
  document.getElementById('m-id').textContent = 'uid_local · 未认证';
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
  if (id) id.textContent = 'uid: ' + user.uid.slice(0, 10) + '... · Pi认证';
  // Reload items to reflect Pi UID ownership
  import('../views/home').then(mod => mod.loadItems());
  updatePiButtonState();
}

/**
 * Update Pi auth button state.
 */
export function updatePiButtonState() {
  const btn = document.getElementById('piAuthBtn');
  if (!btn) return;

  const user = getPiUser();
  const username = user ? (user.username || ('pi_' + (user.uid || '').slice(0, 8))) : null;
  // Pi Browser injects window.Pi natively
  const Pi = typeof window.Pi !== 'undefined';

  if (user && username) {
    btn.textContent = '已登录: @' + username;
    btn.style.opacity = '1';
    btn.onclick = piLogout;
  } else if (Pi) {
    btn.textContent = 'Pi 登录';
    btn.style.opacity = '1';
    btn.onclick = piLogin;
  } else {
    btn.textContent = '请在Pi浏览器登录';
    btn.style.opacity = '.5';
    btn.onclick = () => toast('请下载 Pi Browser App 访问本网站');
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

const BACKEND = 'https://piflea-backend.1281582261.workers.dev';
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
    const res = await fetch(BACKEND + '/api/my-orders?uid=' + encodeURIComponent(user.uid) + '&role=' + role);
    const json = await res.json();
    orderLoader.style.display = 'none';
    const orders = json.data || [];

    if (orders.length === 0) {
      orderEmpty.style.display = 'block';
      orderEmpty.textContent = role === 'buyer' ? '还没有购买记录' : '还没有卖出记录';
      return;
    }

    const statusMap = { 'paid': '待发货', 'shipped': '已发货', 'completed': '已完成' };

    // 缓存订单数据，详情页使用
    cachedOrders[role] = orders;

    orderList.innerHTML = orders.map(function(o) {
      console.log('[renderOrders] orderId=', o.id, 'title=', o.item_title);
      return '<div class="row-item" onclick="window.gotoOrderDetail(' + o.id + ')" style="cursor:pointer">' +
        '<div class="pic" style="background:var(--bg);display:grid;place-items:center;font-size:28px;color:#b8bfd1">' +
          '\ud83d\udce6' +
        '</div>' +
        '<div class="txt">' +
          '<h4>' + (o.item_title || '商品') + '</h4>' +
          '<div class="price">' + (o.item_price || o.amount || 0) + ' \u03c0</div>' +
          '<div class="sub">' + (statusMap[o.status] || o.status) + ' \u00b7 ' + new Date(o.created_at).toLocaleDateString() + '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          (role === 'buyer' && o.status === 'shipped'
            ? '<button class="edit-btn" onclick="event.stopPropagation();window.completeOrder(' + o.id + ')">确认收货</button>'
            : '') +
          (role === 'seller' && o.status === 'paid'
            ? '<button class="edit-btn" onclick="event.stopPropagation();window.markShipped(' + o.id + ')">标记发货</button>'
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

  const statusMap = { 'paid': '待发货', 'shipped': '已发货', 'completed': '已完成' };
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
    '<div style="padding:10px 0">' +
      (isBuyer && order.status === 'shipped'
        ? '<button class="btn primary" onclick="window.completeOrder(' + order.id + ')" style="width:100%;padding:14px">确认收货</button>'
        : '') +
      (!isBuyer && order.status === 'paid'
        ? '<button class="btn primary" onclick="window.markShipped(' + order.id + ')" style="width:100%;padding:14px">标记发货</button>'
        : '') +
      (order.status === 'completed' ? '<div style="text-align:center;color:var(--ok);font-size:14px">✔ 交易已完成</div>' : '') +
    '</div>';

  const content = document.getElementById('od-content');
  if (content) content.innerHTML = html;

  goto('order-detail');

  // 兜底绑定返回按钮（使用 addEventListener 兼容 Pi Browser）
  const backBtn = document.getElementById('od-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[order-detail] 返回按钮点击');
      goto('mine');
    });
  }
}

export async function completeOrder(orderId) {
  const user = getPiUser();
  if (!user) { toast('请先登录'); return; }
  if (!confirm('确认已收到商品？')) return;
  try {
    const res = await fetch(BACKEND + '/api/complete-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, buyer_id: user.uid })
    });
    const json = await res.json();
    if (json.success) { toast('确认收货成功！'); loadOrders('buyer'); }
    else { toast('操作失败：' + (json.error || '未知错误')); }
  } catch (e) { toast('请求失败：' + e.message); }
}

export async function markShipped(orderId) {
  const user = getPiUser();
  if (!user) { toast('请先登录'); return; }
  if (!confirm('确认已发货？')) return;
  try {
    const res = await fetch(BACKEND + '/api/mark-shipped', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, seller_id: user.uid })
    });
    const json = await res.json();
    if (json.success) { toast('已标记发货！'); loadOrders('seller'); }
    else { toast('操作失败：' + (json.error || '未知错误')); }
  } catch (e) { toast('请求失败：' + e.message); }
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


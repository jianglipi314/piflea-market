/* ============ Mine View (Personal Center) ============ */

import { state } from '../main';
import { HIST_KEY, DARK_KEY } from '../state';
import { escapeHtml, fmtPrice, toast, getOwnerId, getAllMyUserIds, getPiUid } from '../utils';
import { getSupabase } from '../supabase';
import { authenticateWithPi, logoutPi, isPiAuthenticated, getPiUser, createPiPayment } from '../pi-sdk';
import { goto } from '../router';
import { openEdit } from './publish';

/**
 * Render the Mine page.
 */
export function renderMine() {
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
 * Switch between 'post' and 'hist' tabs.
 */
export function switchMine(tab) {
  state.mineTab = tab;
  document.querySelectorAll('.tabs .tab').forEach((t) => t.classList.remove('on'));
  document.getElementById('tab-' + tab)?.classList.add('on');

  const loader = document.getElementById('mineLoader');
  const list = document.getElementById('mine-list');
  const empty = document.getElementById('mine-empty');

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
export function editMyName() {
  const current = localStorage.getItem('pi_flea_me') || '';
  const name = prompt('请输入你的昵称（显示在商品页）', current);
  if (name && name.trim()) {
    localStorage.setItem('pi_flea_me', name.trim());
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
  localStorage.removeItem('pi_flea_pi_user_v1');
  const user = await authenticateWithPi();
  if (user) applyPiUser();
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
function applyPiUser() {
  const user = getPiUser();
  if (!user) return;
  const av = document.getElementById('m-avatar');
  const nm = document.getElementById('m-name');
  const id = document.getElementById('m-id');
  if (nm) nm.textContent = '@' + user.username;
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
  // Pi Browser injects window.Pi natively
  const Pi = typeof window.Pi !== 'undefined';

  if (user) {
    btn.textContent = '已登录: @' + user.username;
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

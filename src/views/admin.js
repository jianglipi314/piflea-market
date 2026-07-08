/* ============ Admin View ============ */

import { state } from '../main';
import { getSupabase } from '../supabase';
import { escapeHtml, fmtPrice, toast } from '../utils';

const BACKEND = 'https://piflea-backend.1281582261.workers.dev';

/**
 * Render admin dashboard.
 */
export async function renderAdmin() {
  if (!state.admin) {
    toast('请先在个人中心解锁运营后台');
    return;
  }

  const list = document.getElementById('adminList');
  const loader = document.getElementById('adminLoader');
  loader.style.display = 'block';

  // Show placeholder stats while loading
  document.getElementById('a-items').textContent = '...';
  document.getElementById('a-view').textContent = '...';
  document.getElementById('a-pending').textContent = '...';

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    loader.style.display = 'none';

    // Update stats with fresh data
    const items = data || [];
    document.getElementById('a-items').textContent = items.length;
    const totalViews = items.reduce((s, d) => s + (d.views || 0), 0);
    document.getElementById('a-view').textContent = totalViews;

    list.innerHTML = items
      .map(
        (d) => `
      <div class="row-item">
        <div class="pic">${
          d.images && d.images[0]
            ? `<img src="${d.images[0]}" loading="lazy" decoding="async" onerror="this.style.display='none'"/>`
            : '📦'
        }</div>
        <div class="txt">
          <h4>${escapeHtml(d.title)}</h4>
          <div class="price">${fmtPrice(d.price)} π</div>
          <div class="sub">👁 ${d.views || 0} · ${escapeHtml(d.seller || '')} · #${d.id}</div>
          <div class="mini">推荐: ${d.tpl || '—'}</div>
        </div>
        <div class="row-actions">
          <button class="edit-btn" onclick="window.adminToggleReco(${d.id})">切换推荐</button>
          <button class="rm" onclick="window.adminDelete(${d.id})">删除</button>
        </div>
      </div>`
      )
      .join('');

    // Load pending transfers
    adminLoadTransfers();
  } catch (e) {
    loader.style.display = 'none';
    toast('加载失败：' + e.message);
  }
}

/**
 * Load and display pending transfers from backend.
 */
export async function adminLoadTransfers() {
  const transferLoader = document.getElementById('transferLoader');
  const transferList = document.getElementById('transferList');
  const transferEmpty = document.getElementById('transferEmpty');

  if (transferLoader) transferLoader.style.display = 'block';
  if (transferList) transferList.innerHTML = '';
  if (transferEmpty) transferEmpty.style.display = 'none';

  try {
    const res = await fetch(BACKEND + '/api/admin/pending-transfers');
    const json = await res.json();

    if (transferLoader) transferLoader.style.display = 'none';

    const orders = json.data || [];

    if (orders.length === 0) {
      if (transferEmpty) transferEmpty.style.display = 'block';
      document.getElementById('a-pending').textContent = '0';
      return;
    }

    document.getElementById('a-pending').textContent = orders.length;

    if (transferList) {
      transferList.innerHTML = orders.map(function(o) {
        return '<div class="row-item">' +
          '<div class="pic" style="background:var(--bg);display:grid;place-items:center;font-size:28px;color:#b8bfd1">\ud83d\udcb0</div>' +
          '<div class="txt">' +
            '<h4>' + (o.item_title || '商品') + '</h4>' +
            '<div class="price">' + (o.item_price || o.amount || 0) + ' \u03c0</div>' +
            '<div class="sub">订单#' + o.id + ' \u00b7 ' + new Date(o.created_at).toLocaleDateString() + '</div>' +
            '<div class="sub">卖家: ' + (o.seller_id || '—') + '</div>' +
          '</div>' +
          '<div class="row-actions" style="display:flex;flex-direction:column;gap:6px">' +
            '<button class="edit-btn" onclick="window.adminCopyTransfer(\'' + (o.seller_id || '') + '\',\'' + (o.item_price || o.amount || 0) + '\')">一键复制</button>' +
            '<button class="edit-btn" onclick="window.adminConfirmTransfer(' + o.id + ')" style="color:var(--ok)">确认已转账</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  } catch (e) {
    if (transferLoader) transferLoader.style.display = 'none';
    if (transferEmpty) {
      transferEmpty.style.display = 'block';
      transferEmpty.textContent = '加载失败：' + e.message;
    }
  }
}

/**
 * Copy transfer info to clipboard.
 */
export function adminCopyTransfer(sellerId, amount) {
  const text = '卖家UID: ' + sellerId + '\n转账金额: ' + amount + ' Pi';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      toast('已复制到剪贴板');
    }).catch(function() {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('已复制到剪贴板');
  } catch (e) {
    toast('复制失败，请手动复制');
  }
  document.body.removeChild(ta);
}

/**
 * Confirm transfer for an order.
 */
export async function adminConfirmTransfer(orderId) {
  if (!confirm('确认已向卖家转账？')) return;
  try {
    const res = await fetch(BACKEND + '/api/admin/confirm-transfer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId })
    });
    const json = await res.json();
    if (json.success) {
      toast('已确认转账，订单完成');
      adminLoadTransfers();
    } else {
      toast('操作失败：' + (json.message || json.error || '未知错误'));
    }
  } catch (e) {
    toast('请求失败：' + e.message);
  }
}

/**
 * Toggle recommendation status for an item.
 */
export async function adminToggleReco(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  const newTpl = it.tpl === 'reco' ? '' : 'reco';

  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('items')
      .update({ tpl: newTpl })
      .eq('id', id);
    if (error) throw error;
    it.tpl = newTpl;
    toast(newTpl ? '✅ 已设为推荐' : '已取消推荐');
    renderAdmin();
  } catch (e) {
    toast('操作失败：' + e.message);
  }
}

/**
 * Delete an item.
 */
export async function adminDelete(id) {
  if (!confirm('确定要删除该商品（ID: ' + id + '）吗？')) return;

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) throw error;
    state.items = state.items.filter((x) => x.id !== id);
    toast('已删除');
    renderAdmin();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

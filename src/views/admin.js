/* ============ Admin View ============ */

import { state } from '../main';
import { getSupabase } from '../supabase';
import { escapeHtml, fmtPrice, toast } from '../utils';
import { apiFetch } from '../api';
import { isAdminUser } from './mine';

// 当前激活的 admin tab：reports / products
let adminActiveTab = 'reports';
// 当前举报筛选：pending / reviewed / dismissed / all
let reportFilter = 'pending';

/**
 * 切换 admin tab，按需加载数据。
 */
function switchAdminTab(tab) {
  adminActiveTab = tab;
  // 切换 panel 显示
  ['reports', 'products'].forEach(function(t) {
    const panel = document.getElementById('panel-' + t);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
  });
  // 切换 tab 高亮
  const tabs = document.querySelectorAll('.admin-tab');
  tabs.forEach(function(btn) {
    const active = btn.dataset.adminTab === tab;
    btn.style.borderBottom = active ? '2px solid var(--brand)' : '2px solid transparent';
    btn.style.color = active ? 'var(--brand)' : 'var(--ink-2)';
    btn.style.fontWeight = active ? '700' : '400';
  });
  // 按需加载
  if (tab === 'reports') {
    renderReports(reportFilter);
  } else if (tab === 'products') {
    renderAdmin();
  }
}

/**
 * 初始化 admin tab + 举报筛选事件委托（只绑定一次）。
 */
function initAdminTabs() {
  const tabsBox = document.getElementById('adminTabs');
  if (tabsBox && !tabsBox.dataset.bound) {
    tabsBox.dataset.bound = '1';
    tabsBox.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-admin-tab]');
      if (!btn) return;
      switchAdminTab(btn.dataset.adminTab);
    });
  }
  const refreshReports = document.getElementById('admin-refresh-reports');
  if (refreshReports && !refreshReports.dataset.bound) {
    refreshReports.dataset.bound = '1';
    refreshReports.addEventListener('click', function() {
      renderReports(reportFilter);
    });
  }
  const filterBox = document.getElementById('reportsFilter');
  if (filterBox && !filterBox.dataset.bound) {
    filterBox.dataset.bound = '1';
    filterBox.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-report-filter]');
      if (!btn) return;
      reportFilter = btn.dataset.reportFilter;
      // 高亮切换
      filterBox.querySelectorAll('[data-report-filter]').forEach(function(b) {
        const on = b.dataset.reportFilter === reportFilter;
        b.style.background = on ? 'var(--ink)' : 'var(--card)';
        b.style.color = on ? '#fff' : 'var(--ink-2)';
      });
      renderReports(reportFilter);
    });
  }
}

/**
 * 渲染举报队列。
 */
async function renderReports(filter) {
  const loader = document.getElementById('reportsLoader');
  const listEl = document.getElementById('reportsList');
  const emptyEl = document.getElementById('reportsEmpty');
  if (!listEl) return;

  if (loader) loader.style.display = 'block';
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res = await apiFetch('/api/admin/reports?status=' + encodeURIComponent(filter || 'pending'));
    const json = await res.json();
    if (loader) loader.style.display = 'none';

    if (!res.ok || !json.success) {
      throw new Error(json.error || '加载失败');
    }

    const data = json.data || [];
    if (data.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    const statusMap = {
      pending: { text: '🟡 待处理', color: 'var(--warn)' },
      reviewed: { text: '✅ 已处理', color: 'var(--ok)' },
      dismissed: { text: '⚪ 已忽略', color: 'var(--ink-2)' },
    };
    const statusInfo = statusMap[filter] || statusMap.pending;

    listEl.innerHTML = data.map(function(r) {
      const reporter = (r.reporter_uid || '').slice(0, 8) + '...';
      const dateStr = r.created_at ? new Date(r.created_at).toLocaleString() : '';
      const itemTitle = escapeHtml(r.item_title || '(商品已删除)');
      const itemStatus = r.item_status === 'blocked' ? ' · 🚫已下架' : (r.item_status === 'sold' ? ' · 已售' : (r.item_status === 'pending' ? ' · 交易中' : ''));
      const detailHtml = r.detail ? '<div class="mini" style="margin-top:2px">补充：' + escapeHtml(r.detail) + '</div>' : '';
      const reviewedHtml = r.reviewed_at
        ? '<div class="mini" style="margin-top:2px">处理：' + new Date(r.reviewed_at).toLocaleString() + ' · ' + escapeHtml(r.admin_note || '') + '</div>'
        : '';

      // 风险标签：high=🔴 / medium=🟡 / normal=无
      const riskTag = r.risk_level === 'high'
        ? '<span style="color:#e53935;font-weight:700;font-size:12px;margin-right:4px">🔴 高风险</span>'
        : (r.risk_level === 'medium'
          ? '<span style="color:#fb8c00;font-weight:700;font-size:12px;margin-right:4px">🟡 中风险</span>'
          : '');
      // 举报次数（>1 时显示）
      const countTag = r.report_count > 1
        ? ' · 举报 ' + r.report_count + ' 次'
        : '';
      // 高风险行整体边框/背景
      const rowStyle = r.risk_level === 'high'
        ? 'border:1px solid #e53935;background:rgba(229,57,53,0.04)'
        : (r.risk_level === 'medium'
          ? 'border:1px solid #fb8c00;background:rgba(251,140,0,0.04)'
          : '');

      // 操作按钮：pending 显示处理/忽略/下架；非 pending 显示查看商品
      let actions = '';
      if (r.status === 'pending') {
        actions =
          '<button class="edit-btn" data-action="reviewReport" data-id="' + r.id + '" data-act="reviewed" style="color:var(--ok)">标记处理</button>' +
          '<button class="edit-btn" data-action="reviewReport" data-id="' + r.id + '" data-act="dismissed">忽略</button>' +
          '<button class="rm" data-action="blockItem" data-id="' + r.id + '" data-item="' + r.item_id + '">下架商品</button>';
      } else {
        actions = '<button class="edit-btn" data-action="viewItem" data-id="' + r.item_id + '">查看商品</button>';
      }

      return '<div class="row-item" style="' + rowStyle + '">' +
        '<div class="pic" style="background:var(--bg);display:grid;place-items:center;font-size:24px">🚩</div>' +
        '<div class="txt">' +
          '<h4>' + riskTag + itemTitle + '</h4>' +
          '<div class="price" style="font-size:13px">原因：' + escapeHtml(r.reason) + '</div>' +
          '<div class="sub">举报人: ' + reporter + itemStatus + countTag + '</div>' +
          '<div class="sub">' + dateStr + ' · #' + r.id + '</div>' +
          detailHtml +
          reviewedHtml +
          '<div class="sub" style="color:' + statusInfo.color + ';font-weight:600;margin-top:4px">' + statusInfo.text + '</div>' +
        '</div>' +
        '<div class="row-actions" style="display:flex;flex-direction:column;gap:6px">' + actions + '</div>' +
      '</div>';
    }).join('');

    // 事件委托（只绑定一次）
    if (!listEl.dataset.bound) {
      listEl.dataset.bound = '1';
      listEl.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = Number(btn.dataset.id);
        if (action === 'reviewReport') {
          adminReviewReport(id, btn.dataset.act);
        } else if (action === 'blockItem') {
          adminBlockItem(Number(btn.dataset.item), id);
        } else if (action === 'viewItem') {
          // 跳转商品详情
          import('../router').then(function(mod) {
            mod.goto('detail');
            import('./detail').then(function(d) {
              if (d.openDetail) d.openDetail(id);
            });
          });
        }
      });
    }
  } catch (e) {
    if (loader) loader.style.display = 'none';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = '加载失败：' + e.message;
    }
  }
}

/**
 * 处理举报：标记 reviewed / dismissed。
 */
async function adminReviewReport(reportId, action) {
  const tip = action === 'reviewed' ? '标记为已处理' : '忽略该举报';
  if (!confirm('确认' + tip + '？')) return;
  try {
    const res = await apiFetch('/api/admin/reports/review', {
      method: 'POST',
      body: JSON.stringify({ reportId: reportId, action: action })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      toast(action === 'reviewed' ? '已标记处理' : '已忽略');
      renderReports(reportFilter);
    } else {
      toast('操作失败：' + (json.error || '未知错误'));
    }
  } catch (e) {
    toast('请求失败：' + e.message);
  }
}

/**
 * 下架商品（同时可关联举报记录）。
 */
async function adminBlockItem(itemId, reportId) {
  if (!confirm('确认下架商品 #' + itemId + '？下架后买家无法购买，但已存在的订单不受影响。')) return;
  try {
    const res = await apiFetch('/api/admin/items/block', {
      method: 'POST',
      body: JSON.stringify({ itemId: itemId })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      toast('已下架商品');
      // 若有关联举报，可选同时标记为已处理
      if (reportId) {
        await apiFetch('/api/admin/reports/review', {
          method: 'POST',
          body: JSON.stringify({ reportId: reportId, action: 'reviewed', note: '商品已下架' })
        });
      }
      renderReports(reportFilter);
    } else {
      toast('操作失败：' + (json.error || '未知错误'));
    }
  } catch (e) {
    toast('请求失败：' + e.message);
  }
}

/**
 * Render admin dashboard.
 */
export async function renderAdmin() {
  // 双重校验：前端管理员白名单 + state.admin（由 renderAdminEntry 在登录时设置）
  if (!isAdminUser() && !state.admin) {
    toast('请先在个人中心解锁运营后台');
    return;
  }
  // 管理员登录后自动放行（state.admin 可能因缓存丢失，但 UID 在白名单内即允许）
  if (isAdminUser()) {
    state.admin = 1;
    localStorage.setItem('pi_flea_admin_v3', '1');
  }

  // 初始化 tab + 筛选事件（幂等，只绑定一次）
  initAdminTabs();

  const list = document.getElementById('adminList');
  const loader = document.getElementById('adminLoader');
  loader.style.display = 'block';

  // Show placeholder stats while loading
  document.getElementById('a-items').textContent = '...';
  document.getElementById('a-view').textContent = '...';

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
          <div class="mini">推荐: ${d.tpl || '—'} · ${d.status === 'blocked' ? '🚫 已下架' : (d.status === 'sold' ? '已售' : (d.status === 'pending' ? '⏳ 交易中' : '在售'))}</div>
        </div>
        <div class="row-actions">
          <button class="edit-btn" data-action="toggleReco" data-id="${d.id}">切换推荐</button>
          ${d.status === 'blocked' ? '<button class="edit-btn" data-action="unblockItem" data-id="' + d.id + '" style="color:var(--ok)">恢复上架</button>' : '<button class="rm" data-action="delete" data-id="' + d.id + '">删除</button>'}
        </div>
      </div>`
      )
      .join('');

    // 事件委托（替换内联 onclick，兼容 Pi Browser）
    if (list && !list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = Number(btn.dataset.id);
        if (action === 'toggleReco') adminToggleReco(id);
        else if (action === 'delete') adminDelete(id);
        else if (action === 'unblockItem') adminUnblockItem(id);
      });
    }

    // 默认激活举报队列 tab（自动加载 reports）
    switchAdminTab('reports');
  } catch (e) {
    loader.style.display = 'none';
    toast('加载失败：' + e.message);
  }
}

/**
 * 恢复商品上架。
 */
async function adminUnblockItem(itemId) {
  if (!confirm('确认恢复商品 #' + itemId + ' 上架？')) return;
  try {
    const res = await apiFetch('/api/admin/items/unblock', {
      method: 'POST',
      body: JSON.stringify({ itemId: itemId })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      toast('已恢复上架');
      renderAdmin();
    } else {
      toast('操作失败：' + (json.error || '未知错误'));
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

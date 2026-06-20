/* ============ Admin View ============ */

import { state } from '../main';
import { getSupabase } from '../supabase';
import { escapeHtml, fmtPrice, toast } from '../utils';

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
  document.getElementById('a-chat').textContent = '∞';

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
  } catch (e) {
    loader.style.display = 'none';
    toast('加载失败：' + e.message);
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

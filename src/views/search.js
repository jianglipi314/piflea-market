/* ============ Search View ============ */

import { getSupabase, decodeItem } from '../supabase';
import { state } from '../main';
import { HOT_TAGS, CAT_ICON } from '../state';
import { cardHTML } from '../components/card';
import { toast, debounce } from '../utils';

/**
 * qInput / 清除按钮 的监听已统一在 main.js (DOMContentLoaded) 中绑定，
 * 此处保留空函数以兼容 renderTagCloud 的调用，避免重复绑定。
 */
export function initSearchInput() {
}

/**
 * Render the tag cloud.
 */
export function renderTagCloud() {
  initSearchInput();
  document.getElementById('tagcloud').innerHTML = HOT_TAGS.map(
    (t) =>
      `<button class="t" data-tag="${t}">${t}</button>`
  ).join('');

  // 事件委托（替换内联 onclick，兼容 Pi Browser）
  const tagcloud = document.getElementById('tagcloud');
  if (tagcloud && !tagcloud.dataset.bound) {
    tagcloud.dataset.bound = '1';
    tagcloud.addEventListener('click', function(e) {
      const tag = e.target.closest('[data-tag]');
      if (tag) {
        const q = document.getElementById('qInput');
        if (q) q.value = tag.dataset.tag;
        doSearch();
      }
    });
  }
}

/**
 * Perform the search query.
 */
export async function doSearch() {
  const q = document.getElementById('qInput').value.trim().toLowerCase();
  const list = document.getElementById('searchList');
  const empty = document.getElementById('searchEmpty');
  const loader = document.getElementById('searchLoader');

  if (!q) {
    list.innerHTML = '';
    empty.style.display = 'none';
    loader.style.display = 'none';
    return;
  }

  loader.style.display = 'block';
  list.innerHTML = '';
  empty.style.display = 'none';

  try {
    // Remove special characters that could interfere with ilike pattern matching
    const safeQ = q.replace(/[%_\\]/g, '');
    const supabase = getSupabase();
    let query = supabase
      .from('items')
      .select('*')
      .or(
        `title.ilike.%${safeQ}%,description.ilike.%${safeQ}%,category.ilike.%${safeQ}%,seller.ilike.%${safeQ}%,city.ilike.%${safeQ}%`
      );
    query = query.order('created_at', { ascending: false }).limit(50);
    const { data, error } = await query;

    if (error) throw error;

    const results = (data || []).map(decodeItem);
    loader.style.display = 'none';

    if (results.length) {
      empty.style.display = 'none';
    } else {
      empty.style.display = 'block';
      empty.textContent = `没有找到 "${q}" 相关商品`;
    }
    list.innerHTML = results.map((it) => cardHTML(it)).join('');
  } catch (e) {
    loader.style.display = 'none';
    toast('搜索失败：' + (e.message || ''));
  }
}

/**
 * Trigger search on input change — debounced 300ms.
 */
export const onSearch = debounce(() => {
  doSearch();
}, 300);

/* ============ Home View ============ */

import { getSupabase, decodeItem } from '../supabase';
import { state } from '../main';
import { CATS, CAT_ICON } from '../state';
import { recoHTML, cardHTML } from '../components/card';
import { toast } from '../utils';

/**
 * Load items from Supabase and re-render home.
 */
export async function loadItems() {
  document.getElementById('listLoader').style.display = 'block';
  document.getElementById('list').innerHTML = '';
  document.getElementById('empty').style.display = 'none';

  const supabase = getSupabase();
  if (!supabase) {
    document.getElementById('listLoader').style.display = 'none';
    toast('云端连接中，请稍候...');
    setTimeout(loadItems, 800);
    return;
  }

  try {
    let query = supabase.from('items').select('*');
    if (state.cat !== '全部') query = query.eq('category', state.cat);
    // By default, only show active items on home page
    query = query.eq('status', 'active');

    let sortCol = 'created_at';
    let asc = false;
    if (state.sort === 'priceAsc') { sortCol = 'price'; asc = true; }
    else if (state.sort === 'priceDesc') { sortCol = 'price'; asc = false; }
    else if (state.sort === 'hot') { sortCol = 'fav_count'; asc = false; }

    query = query.order(sortCol, { ascending: asc });
    const { data, error } = await query;

    if (error) throw error;

    state.items = (data || []).map(decodeItem);
    renderHome();
  } catch (e) {
    console.error('loadItems error', e);
    document.getElementById('listLoader').style.display = 'none';
    const empty = document.getElementById('empty');
    empty.style.display = 'block';
    empty.textContent = '云端加载失败，请刷新重试';
    toast('云端加载失败');
  }
}

/**
 * Set category filter and reload.
 */
export function setCat(c) {
  state.cat = c;
  loadItems();
}

/**
 * Toggle recommendation-only mode.
 */
export function toggleReco() {
  state.onlyReco = !state.onlyReco;
  renderHome();
}

/**
 * Set sort mode and reload.
 */
export function setSort(s) {
  state.sort = s;
  loadItems();
}

/**
 * Render the home page from current state.
 */
export function renderHome() {
  document.getElementById('listLoader').style.display = 'none';

  // Category chips
  document.getElementById('cats').innerHTML = CATS.map(
    (c) =>
      `<button class="chip ${c === state.cat ? 'on' : ''}" data-cat="${c}"><span class="dot"></span>${CAT_ICON[c] || '•'} ${c}</button>`
  ).join('');
  document.getElementById('catTip').textContent = state.cat;

  // Sort chips
  const sorts = [
    ['new', '最新'],
    ['priceAsc', '价格 ↑'],
    ['priceDesc', '价格 ↓'],
    ['hot', '最热'],
  ];
  document.getElementById('sortbar').innerHTML = sorts
    .map(
      (s) =>
        `<button class="chip ${state.sort === s[0] ? 'on' : ''}" data-sort="${s[0]}"><span class="dot"></span>${s[1]}</button>`
    )
    .join('');

  // Grid items
  let items = state.items.slice();
  document.getElementById('empty').style.display = items.length ? 'none' : 'block';
  document.getElementById('list').innerHTML = items.map((it) => cardHTML(it)).join('');

  // 事件委托（替换内联 onclick，兼容 Pi Browser）
  const catsEl = document.getElementById('cats');
  if (catsEl && !catsEl.dataset.bound) {
    catsEl.dataset.bound = '1';
    catsEl.addEventListener('click', function(e) {
      const chip = e.target.closest('[data-cat]');
      if (chip) setCat(chip.dataset.cat);
    });
  }
  const sortbarEl = document.getElementById('sortbar');
  if (sortbarEl && !sortbarEl.dataset.bound) {
    sortbarEl.dataset.bound = '1';
    sortbarEl.addEventListener('click', function(e) {
      const chip = e.target.closest('[data-sort]');
      if (chip) setSort(chip.dataset.sort);
    });
  }
}

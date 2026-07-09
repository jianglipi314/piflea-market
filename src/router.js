/* ============ View Router ============ */

import { state } from './main';
import { loadItems } from './views/home';
import { renderMine } from './views/mine';
import { renderTagCloud, onSearch } from './views/search';
import { loadChatList, markChatsViewed } from './views/chats';
import { renderAdmin } from './views/admin';
import { clearForm, initFormListener } from './views/publish';

const viewTitles = {
  home:   ['pi 跳蚤市场', '先锋二手 · 为派赋能'],
  search: ['搜索', '关键词 / 分类 / 排序'],
  publish: ['发布商品', '免费发布'],
  detail: ['商品详情', '平台担保交易 · 收货后放款'],
  order:  ['确认订单', '担保交易 · 资金托管'],
  'order-detail': ['订单详情', '平台担保交易 · 收货后放款'],
  chats:  ['消息中心', '本地模拟对话'],
  chat:   ['聊天', '与卖家沟通'],
  mine:   ['我的', '个人中心'],
  admin:  ['运营后台', '云端管理面板'],
};

/**
 * Navigate to named view.
 * @param {string} name - view id (e.g. 'home', 'search', 'publish')
 */
export function goto(name) {
  // Deactivate all views
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

  // Activate target
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');

  // Update nav state
  document.querySelectorAll('.nav button[data-v]').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === name)
  );

  // Update topbar title
  const t = viewTitles[name] || viewTitles.home;
  document.getElementById('topTitle').textContent = t[0];
  document.getElementById('topSub').textContent = t[1];

  // Side effects per view
  if (name === 'home') loadItems();
  if (name === 'mine') renderMine();
  if (name === 'search') {
    renderTagCloud();
    onSearch();
  }
  if (name === 'chats') { loadChatList(); markChatsViewed(); }
  if (name === 'admin') renderAdmin();
  if (name === 'publish') {
    initFormListener();
    // Clear stale editId when navigating via nav bar (not via openEdit)
    if (state.editId) {
      clearForm();
    }
  }

  // Toggle detail FAB
  const fab = document.getElementById('d-fab');
  if (fab) fab.style.display = name === 'detail' ? 'flex' : 'none';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Wire up nav button click handlers.
 */
export function initNav() {
  document.querySelectorAll('.nav button[data-v]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.v;
      if (v) goto(v);
    });
  });
}

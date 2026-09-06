/* ============ View Router ============ */

import { state } from './main';
import { loadItems } from './views/home';
import { renderMine } from './views/mine';
import { renderTagCloud, onSearch } from './views/search';
import { loadChatList } from './views/chats';
import { renderAdmin } from './views/admin';

import { clearForm, initFormListener } from './views/publish';

const viewTitles = {
  home:   ['pi 跳蚤市场', '先锋二手 · 为派赋能'],
  search: ['搜索', '关键词 / 分类 / 排序'],
  publish: ['发布商品', '免费发布'],
  detail: ['商品详情', '平台担保交易 · 收货后放款'],
  order:  ['确认订单', '担保交易 · 资金托管'],
  'order-detail': ['订单详情', '平台担保交易 · 收货后放款'],
  chats: ['消息中心', '平台担保交易 · 收货后放款'],
  chat:   ['聊天', '与卖家沟通'],
  mine:   ['我的', '个人中心'],
  admin:  ['运营后台', '云端管理面板'],
  
};

/**
 * 获取当前激活视图名（无激活视图时返回 ''）。
 */
function activeViewName() {
  const el = document.querySelector('.view.active');
  return el ? el.id.replace('view-', '') : '';
}

/**
 * 切换视图（不触碰浏览器历史）。原有页面切换副作用全部保留。
 * hist: 历史条目字段 { view, t, s }；系统返回键回退时用它恢复顶栏标题
 * （chat/order 等页面的标题由进入函数动态设置，不在 viewTitles 里）。
 */
function showView(name, hist) {
  // Deactivate all views
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

  // Activate target
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');

  // Update nav state
  document.querySelectorAll('.nav button[data-v]').forEach((b) =>
    b.classList.toggle('on', b.dataset.v === name)
  );

  // Update topbar title（优先用历史条目里快照的标题）
  const vt = viewTitles[name] || viewTitles.home;
  document.getElementById('topTitle').textContent = (hist && hist.t) || vt[0];
  document.getElementById('topSub').textContent = (hist && hist.s) || vt[1];

  // Side effects per view
  if (name === 'home') loadItems();
  if (name === 'mine') renderMine();
  if (name === 'search') {
    renderTagCloud();
    onSearch();
  }
  // 传入 markViewed=true：loadChatList 在完成未读计算、更新红点和渲染列表后才标记已查看
  if (name === 'chats') loadChatList(true);
  if (name === 'admin') renderAdmin();
  if (name === 'publish') {
    initFormListener();
    // Clear stale editId when navigating via nav bar (not via openEdit)
    if (state.editId) {
      clearForm();
    }
    // 记录发布页来源（openEdit 会覆盖为更准确的来源）
    const cur = document.querySelector('.view.active');
    const curName = cur ? cur.id.replace('view-', '') : 'home';
    if (curName !== 'publish') {
      state.publishReturnTo = curName;
    }
  }

  // Toggle detail FAB
  const fab = document.getElementById('d-fab');
  if (fab) fab.style.display = name === 'detail' ? 'flex' : 'none';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * 为视图压入一条浏览器历史（切完视图、设好顶栏后调用）。
 * title/sub 缺省用 viewTitles；chat/order 等动态标题的入口传入实际值。
 */
export function pushViewHistory(name, title, sub) {
  const vt = viewTitles[name] || viewTitles.home;
  try {
    history.pushState(
      { view: name, t: title || vt[0], s: sub || vt[1] },
      '',
      '#/' + name
    );
  } catch (e) {
    // 个别 WebView 禁用 History API 时静默降级（返回键维持原生行为）
  }
}

/**
 * Navigate to named view.
 * @param {string} name - view id (e.g. 'home', 'search', 'publish')
 */
export function goto(name) {
  const from = activeViewName();
  showView(name);
  // 重复进入同一视图（如连点当前底部 tab）不压栈，避免「按返回没反应」的冗余记录
  if (from === name) return;
  pushViewHistory(name);
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

  // ===== History API：系统返回键 / Pi Browser 返回键 =====
  // 初始条目：replaceState 建立栈底（通常为 home）。
  // 暂不支持深链接恢复：无论 URL 带什么 hash，都从当前激活视图起步。
  const initName = activeViewName() || 'home';
  const ivt = viewTitles[initName] || viewTitles.home;
  try {
    history.replaceState({ view: initName, t: ivt[0], s: ivt[1] }, '', '#/' + initName);
  } catch (e) { /* History API 不可用时忽略 */ }

  // 系统返回键：popstate 弹出上一条历史，按真实访问路径逐级返回
  window.addEventListener('popstate', (e) => {
    const st = e.state;
    const name = st && st.view ? st.view : 'home';
    showView(name, st);
    // 返回「我的」时恢复之前所在 tab（与详情/发布页返回按钮现有行为一致，mineTab 保留兜底）
    if (name === 'mine' && state.mineTab && state.mineTab !== 'overview') {
      import('./views/mine').then((mod) => mod.switchMine(state.mineTab));
    }
  });
}

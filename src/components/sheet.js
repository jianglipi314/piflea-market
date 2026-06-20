/* ============ Sheet (Bottom Modal) ============ */

import { toast } from '../utils';
import { state } from '../main';
import { goto } from '../router';

/**
 * Open a sheet by kind.
 * @param {string} kind — 'menu' | 'share' | 'report'
 */
export function openSheet(kind) {
  const box = document.getElementById('sheet');
  const title = document.getElementById('sheetTitle');
  const body = document.getElementById('sheetBody');
  const acts = document.getElementById('sheetActions');
  acts.innerHTML = '';

  if (kind === 'menu') {
    title.textContent = 'π 跳蚤市场';
    body.innerHTML =
      '欢迎来到 π 跳蚤市场！<br/>· 🔍 搜索页按关键词 / 分类筛选<br/>· 📝 发布商品永久免费<br/>· 💬 与卖家对话<br/>· 👤 个人中心查看发布 / 收藏<br/>· 🌙 切换浅色 / 深色主题<br/>· ⇪ 分享商品 / 举报违规';
    acts.innerHTML = `
      <button class="btn ghost" onclick="closeSheet();goto('search')">去搜索</button>
      <button class="btn primary" onclick="closeSheet();goto('publish')">发闲置</button>`;
  } else if (kind === 'share') {
    const it = state.items.find((x) => x.id === state.currentDetailId);
    title.textContent = '分享商品';
    if (it) {
      body.innerHTML = `链接：<code style="background:var(--line);padding:2px 6px;border-radius:4px">pi-market://item/${it.id}</code><br/>点击复制链接分享给好友。`;
      acts.innerHTML = `<button class="btn primary" onclick="navigator.clipboard&&navigator.clipboard.writeText('pi-market://item/${it.id}');toast('已复制链接');closeSheet()">复制链接</button>`;
    } else {
      body.innerHTML = '请先进入商品详情';
    }
  } else if (kind === 'report') {
    title.textContent = '举报该商品';
    body.innerHTML = '请选择举报类型：';
    acts.innerHTML = ['虚假描述', '违禁品', '涉嫌诈骗', '其他']
      .map(
        (t) =>
          `<button class="btn ghost" onclick="toast('已提交：${t}');closeSheet()">${t}</button>`
      )
      .join('');
  }

  box.classList.add('on');
}

export function closeSheet() {
  document.getElementById('sheet').classList.remove('on');
}

export function initSheet() {
  document.getElementById('sheet').addEventListener('click', (e) => {
    if (e.target.id === 'sheet') closeSheet();
  });
}

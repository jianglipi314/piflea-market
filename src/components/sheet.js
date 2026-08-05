/* ============ Sheet (Bottom Modal) ============ */

import { toast } from '../utils';
import { state } from '../main';
import { goto } from '../router';
import { apiFetch } from '../api';
import { getPiUser } from '../pi-sdk';

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
    const reasons = ['虚假描述', '违禁品', '涉嫌诈骗', '其他'];
    body.innerHTML =
      '<div style="font-size:13px;color:var(--ink-2);margin-bottom:10px">请选择举报类型：</div>' +
      '<div id="report-reasons" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
        reasons.map((t) =>
          '<button type="button" class="btn ghost" data-reason="' + t + '" ' +
          'style="padding:8px 14px;font-size:13px">' + t + '</button>'
        ).join('') +
      '</div>' +
      '<textarea id="report-detail" placeholder="补充说明（选填，最多 500 字）" maxlength="500" ' +
      'style="width:100%;min-height:72px;padding:10px;border:1px solid var(--line);border-radius:8px;' +
      'font-size:13px;background:var(--bg);color:var(--ink);box-sizing:border-box;resize:vertical"></textarea>';
    acts.innerHTML =
      '<button class="btn ghost" id="report-cancel">取消</button>' +
      '<button class="btn primary" id="report-submit">提交举报</button>';

    // 选项单选（事件委托，替代内联 onclick，兼容 Pi Browser）
    let selectedReason = '';
    const reasonBox = document.getElementById('report-reasons');
    reasonBox.addEventListener('click', function(e) {
      const btn = e.target.closest('[data-reason]');
      if (!btn) return;
      selectedReason = btn.dataset.reason;
      reasonBox.querySelectorAll('[data-reason]').forEach(function(b) {
        b.style.background = b === btn ? 'var(--ink)' : 'var(--card)';
        b.style.color = b === btn ? '#fff' : 'var(--ink-2)';
      });
    });

    // 取消
    document.getElementById('report-cancel').addEventListener('click', closeSheet);

    // 提交举报
    document.getElementById('report-submit').addEventListener('click', async function() {
      const itemId = state.currentDetailId;
      if (!itemId) { toast('未找到商品'); return; }
      if (!selectedReason) { toast('请选择举报类型'); return; }
      if (!getPiUser()) { toast('请先登录 Pi 账号'); return; }
      const detail = (document.getElementById('report-detail').value || '').trim();
      const btn = this;
      btn.disabled = true;
      btn.textContent = '提交中...';
      try {
        const res = await apiFetch('/api/report', {
          method: 'POST',
          body: JSON.stringify({
            itemId: itemId,
            reason: selectedReason,
            detail: detail || undefined,
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          toast('举报已提交，平台将尽快处理');
          closeSheet();
        } else {
          toast(json.error || '提交失败');
          btn.disabled = false;
          btn.textContent = '提交举报';
        }
      } catch (e) {
        console.error('report submit err:', e);
        toast('网络错误：' + (e?.message || e));
        btn.disabled = false;
        btn.textContent = '提交举报';
      }
    });
  } else if (kind === 'feedback') {
    title.textContent = '帮助与反馈';
    body.innerHTML = `
      <div style="margin-bottom:12px">
        <b>常见问题</b><br/>
        · 如何发布商品？点击底部「发布」按钮<br/>
        · 如何联系卖家？进入商品详情点击「联系卖家」<br/>
        · 支付安全吗？平台担保交易，确认收货后才付款
      </div>
      <div style="margin-bottom:12px">
        <b>联系我们</b><br/>
        邮箱：support@piflea.com
      </div>`;
    acts.innerHTML = `<button class="btn ghost" onclick="closeSheet()">关闭</button>`;
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

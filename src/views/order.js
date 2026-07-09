﻿import { state } from '../main';
import { escapeHtml, fmtPrice, toast } from '../utils';
import { createPiPayment, isPiAuthenticated, getPiUser } from '../pi-sdk';
import { goto } from '../router';
import { apiFetch, BACKEND_URL as BACKEND } from '../api';

const FEE_MODE = 'A';
const NETWORK_FEE = 0;
const PLATFORM_FEE_RATE = 0.02;

let currentOrderItem = null;
let lastPaymentId = null;

export function openOrder(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) { toast('商品不存在'); return; }

  const myIds = (window.getAllMyUserIds && window.getAllMyUserIds()) || [];
  if (it.owner_id && myIds.includes(it.owner_id)) {
    toast('不能购买自己的商品');
    return;
  }

  currentOrderItem = it;
  state.currentDetailId = it.id; // 确保返回商品详情页时有数据

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-order').classList.add('active');
  document.querySelectorAll('.nav button').forEach((b) => b.classList.remove('on'));

  // 更新顶部标题
  document.getElementById('topTitle').textContent = '确认订单';
  document.getElementById('topSub').textContent = '请核对商品信息后支付';

  // 兜底：确保返回按钮事件绑定有效
  const backBtn = document.getElementById('o-back-btn');
  if (backBtn) {
    backBtn.onclick = () => goto('detail');
  }

  // 绑定确认支付按钮（idempotent via flag，替代内联 onclick）
  const confirmBtn = document.getElementById('o-confirm-btn');
  if (confirmBtn && !confirmBtn._bound) {
    confirmBtn._bound = true;
    confirmBtn.addEventListener('click', confirmPayment);
  }

  document.getElementById('o-emoji').textContent = it.emoji || '\u{1F4E6}';
  document.getElementById('o-title').textContent = it.title || '—';
  document.getElementById('o-seller').textContent = '\u5356\u5BB6\uFF1A' + (it.seller || '\u672A\u77E5');
  document.getElementById('o-meta').textContent = (it.cat || '') + (it.city ? ' \u00B7 ' + it.city : '');

  const picDiv = document.getElementById('o-pic');
  const oldImg = picDiv.querySelector('img');
  if (it.images && it.images[0]) {
    if (!oldImg) {
      const img = document.createElement('img');
      img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover';
      picDiv.insertBefore(img, picDiv.firstChild);
    }
    picDiv.querySelector('img').src = it.images[0];
    document.getElementById('o-emoji').style.display = 'none';
  } else {
    if (oldImg) oldImg.remove();
    document.getElementById('o-emoji').style.display = '';
  }

  const price = Number(it.price) || 0;
  const shippingFee = Number(it.shipping_fee) || 0;
  const platformFee = FEE_MODE === 'A' ? 0 : (FEE_MODE === 'B' ? price * PLATFORM_FEE_RATE : 0);
  const total = price + shippingFee + platformFee + NETWORK_FEE;

  document.getElementById('o-item-price').textContent = fmtPrice(price) + ' \u03C0';
  const shippingEl = document.getElementById('o-shipping-fee');
  if (shippingFee > 0) {
    shippingEl.textContent = fmtPrice(shippingFee) + ' \u03C0';
    shippingEl.style.color = 'var(--ink)';
  } else {
    shippingEl.textContent = '\u5305\u90AE';
    shippingEl.style.color = 'var(--ok)';
  }
  if (FEE_MODE === 'A') {
    document.getElementById('o-fee').innerHTML = '\u{1F389} 0.00 \u03C0 <span style="font-size:11px;color:var(--ok)">\u9650\u65F6\u514D\u8D39</span>';
  } else {
    document.getElementById('o-fee').textContent = fmtPrice(platformFee) + ' \u03C0';
  }
  document.getElementById('o-network-fee').innerHTML = '\u{1F389} ' + fmtPrice(NETWORK_FEE) + ' \u03C0 <span style="font-size:11px;color:var(--ok)">Pi\u7F51\u7EDC\u6536\u53D6\uFF08\u4EE5\u94B1\u5305\u663E\u793A\u4E3A\u51C6\uFF09</span>';
  document.getElementById('o-total').textContent = fmtPrice(total) + ' \u03C0';
  document.getElementById('o-confirm-btn').textContent = '\u786E\u8BA4\u652F\u4ED8 ' + fmtPrice(total) + ' \u03C0';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function createOrder(paymentId, txid) {
  const item = currentOrderItem;
  const user = getPiUser();
  if (!item || !user) return;
  // 防止取消/失败时误创建订单
  if (!paymentId || !txid) {
    console.warn('[createOrder] missing paymentId or txid, aborting');
    return;
  }

  const sellerId = item.owner_id || 'seller_' + (item.seller || 'unknown');
  const buyerId = user.uid || '';

  try {
    await apiFetch('/api/create-order', {
      method: 'POST',
      body: JSON.stringify({
        payment_id: paymentId,
        txid: txid || '',
        buyer_id: buyerId,
        seller_id: sellerId,
        item_id: item.id,
        item_title: item.title || '',
        item_price: item.price || 0,
        amount: Number(item.price || 0) + NETWORK_FEE,
        memo: 'Piflea: ' + (item.title || '')
      })
    });
  } catch (e) {
    console.error('Create order failed:', e);
  }
}

export function confirmPayment() {
  if (!currentOrderItem) { toast('\u8BA2\u5355\u4FE1\u606F\u4E22\u5931'); return; }
  if (!window.Pi) {
    toast('Pi SDK \u4E0D\u53EF\u7528\uFF0C\u8BF7\u5728 Pi Browser \u4E2D\u6253\u5F00');
    return;
  }

  const btn = document.getElementById('o-confirm-btn');
  btn.disabled = true;
  btn.textContent = '\u652F\u4ED8\u5904\u7406\u4E2D...';

  const price = Number(currentOrderItem.price) || 0;
  const platformFee = FEE_MODE === 'A' ? 0 : (FEE_MODE === 'B' ? price * PLATFORM_FEE_RATE : 0);
  const total = price + platformFee + NETWORK_FEE;

  const piUser = getPiUser();
  createPiPayment(
    total,
    'Piflea: ' + currentOrderItem.title,
    {
      itemId: currentOrderItem.id,
      itemTitle: currentOrderItem.title || '',
      itemPrice: total,
      amount: total,
      seller: currentOrderItem.seller,
      mode: FEE_MODE,
      buyerId: piUser ? piUser.uid : null,
      sellerId: currentOrderItem.owner_id || null,
    },
    function(success, msg, paymentId, txid) {
      btn.disabled = false;
      btn.textContent = '\u786E\u8BA4\u652F\u4ED8 ' + fmtPrice(total) + ' \u03C0';
      if (success && paymentId && txid) {
        // Save order to database
        createOrder(paymentId, txid);
        showPaymentSuccess(total);
      } else if (msg) {
        toast('\u652F\u4ED8\u5931\u8D25\uFF1A' + msg);
      }
    }
  ).catch(function(err) {
    btn.disabled = false;
    btn.textContent = '\u786E\u8BA4\u652F\u4ED8 ' + fmtPrice(total) + ' \u03C0';
    console.error('createPiPayment error:', err);
  });
}

/**
 * 付款成功弹窗
 */
function showPaymentSuccess(amount) {
  // 如果已有弹窗先移除
  const old = document.getElementById('pay-success-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'pay-success-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);animation:fadeIn 0.3s ease;';
  modal.innerHTML = `
    <div style="background:var(--card,#fff);border-radius:20px;padding:32px 28px;max-width:320px;width:86%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.2);animation:scaleIn 0.3s ease;">
      <div style="font-size:56px;margin-bottom:12px;">✅</div>
      <div style="font-size:20px;font-weight:700;color:var(--text,#222);margin-bottom:8px;">支付成功！</div>
      <div style="font-size:15px;color:var(--text2,#888);margin-bottom:24px;">已支付 ${fmtPrice(amount)} π<br>订单已创建，等待卖家发货</div>
      <button id="pay-success-btn" style="background:var(--primary,#6C4CF1);color:#fff;border:none;border-radius:12px;padding:13px 0;width:100%;font-size:16px;font-weight:600;cursor:pointer;">查看我的订单</button>
    </div>
  `;

  // 加动画样式
  if (!document.getElementById('pay-success-anim')) {
    const style = document.createElement('style');
    style.id = 'pay-success-anim';
    style.textContent = `
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes scaleIn { from { transform: scale(0.85); opacity: 0 } to { transform: scale(1); opacity: 1 } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(modal);

  // 点击按钮跳转到"我的"
  const okBtn = modal.querySelector('#pay-success-btn');
  okBtn.addEventListener('click', function() {
    modal.remove();
    goto('mine');
  });

  // 点击遮罩也可以关闭
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      modal.remove();
      goto('mine');
    }
  });
}


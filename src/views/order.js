/* ============ Order Confirmation View ============ */

import { state } from '../main';
import { escapeHtml, fmtPrice, toast, getAllMyUserIds } from '../utils';
import { createPiPayment, isPiAuthenticated } from '../pi-sdk';
import { goto } from '../router';

// Current fee mode: A = free (冷启动), B = buyer pays, C = seller pays
const FEE_MODE = 'A';

const NETWORK_FEE = 0.01;
const PLATFORM_FEE_RATE = 0.02; // 2% for mode B/C

let currentOrderItem = null;

/**
 * Open the order confirmation page for an item.
 */
export function openOrder(id) {
  const it = state.items.find((x) => x.id === id);
  if (!it) { toast('商品不存在'); return; }

  // Prevent buying your own item
  const myIds = getAllMyUserIds();
  if (it.owner_id && myIds.includes(it.owner_id)) {
    toast('不能购买自己的商品');
    return;
  }

  currentOrderItem = it;

  // Switch to order view
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-order').classList.add('active');
  document.querySelectorAll('.nav button').forEach((b) => b.classList.remove('on'));

  // Fill item info
  document.getElementById('o-emoji').textContent = it.emoji || '📦';
  document.getElementById('o-title').textContent = it.title || '—';
  document.getElementById('o-seller').textContent = '卖家：' + (it.seller || '未知');
  document.getElementById('o-meta').textContent = (it.cat || '') + (it.city ? ' · ' + it.city : '');

  // Show image if available
  const picDiv = document.getElementById('o-pic');
  const oldImg = picDiv.querySelector('img');
  if (it.images && it.images[0]) {
    if (!oldImg) {
      const img = document.createElement('img');
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      picDiv.insertBefore(img, picDiv.firstChild);
    }
    picDiv.querySelector('img').src = it.images[0];
    document.getElementById('o-emoji').style.display = 'none';
  } else {
    if (oldImg) oldImg.remove();
    document.getElementById('o-emoji').style.display = '';
  }

  // Calculate fees
  const price = Number(it.price) || 0;
  const platformFee = FEE_MODE === 'A' ? 0 : (FEE_MODE === 'B' ? price * PLATFORM_FEE_RATE : 0);
  const total = price + platformFee + NETWORK_FEE;

  document.getElementById('o-item-price').textContent = fmtPrice(price) + ' π';

  if (FEE_MODE === 'A') {
    document.getElementById('o-fee').innerHTML = '🎉 0.00 π <span style="font-size:11px;color:var(--ok)">限时免费</span>';
  } else {
    document.getElementById('o-fee').textContent = fmtPrice(platformFee) + ' π';
  }

  document.getElementById('o-network-fee').textContent = fmtPrice(NETWORK_FEE) + ' π';
  document.getElementById('o-total').textContent = fmtPrice(total) + ' π';
  document.getElementById('o-confirm-btn').textContent = '确认支付 ' + fmtPrice(total) + ' π';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Confirm payment — called from the button.
 */
export async function confirmPayment() {
  if (!currentOrderItem) { toast('订单信息丢失'); return; }

  // Check Pi SDK availability and authentication
  if (!window.Pi) {
    toast('Pi SDK 不可用，请在 Pi Browser 中打开');
    return;
  }

  // Ensure the user is authenticated for payment
  if (!isPiAuthenticated()) {
    toast('请先在个人中心点击 Pi 登录');
    goto('mine');
    return;
  }

  const btn = document.getElementById('o-confirm-btn');
  btn.disabled = true;
  btn.textContent = '支付处理中...';

  const price = Number(currentOrderItem.price) || 0;
  const platformFee = FEE_MODE === 'A' ? 0 : (FEE_MODE === 'B' ? price * PLATFORM_FEE_RATE : 0);
  const total = price + platformFee + NETWORK_FEE;

  // createPayment 是同步方法，直接调用即可，结果由 callbacks 通知
  createPiPayment(
    total,
    'Piflea: ' + currentOrderItem.title,
    {
      itemId: currentOrderItem.id,
      seller: currentOrderItem.seller,
      mode: FEE_MODE,
    }
  );
  // 按钮状态由 Pi SDK 回调中的 toast 通知，这里立即恢复
  btn.disabled = false;
  btn.textContent = '确认支付 ' + fmtPrice(total) + ' π';
}

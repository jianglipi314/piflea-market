/**
 * Piflea Backend - Cloudflare Workers
 * 对照官方 Pi Demo (https://github.com/pi-apps/demo) 修复支付流程
 *
 * 环境变量（在 Cloudflare Dashboard 设置）：
 * - PI_API_KEY: Pi Platform API Server Key (格式: Key xxxxxxxx)
 * - PLATFORM_API_URL: https://api.minepi.com (或测试网 URL)
 * - FRONTEND_URL: https://piflea.com
 * - SUPABASE_URL / SUPABASE_KEY: 数据库连接
 * - WALLET_PRIVATE_SEED: 开发者钱包私钥（S 开头，用于 A2U 自动转账）
 */

import { Keypair, Operation, Asset, TransactionBuilder, Memo, StrKey, Networks, Account } from '@stellar/stellar-base';

// ============ 常量 ============
const PLATFORM_API_URL = 'https://api.minepi.com';

// Pi 链 Horizon 配置（来自 pi-nodejs 官方 .env.production）
const PI_HORIZON_TESTNET_URL = 'https://api.testnet.minepi.com';
const PI_HORIZON_TESTNET_PASSPHRASE = 'Pi Testnet';
const PI_HORIZON_MAINNET_URL = 'https://api.mainnet.minepi.com';
const PI_HORIZON_MAINNET_PASSPHRASE = 'Pi Network';
const PI_HORIZON_DEFAULT_TIMEBOUNDS = 180; // 秒

// CORS 处理：根据环境变量动态设置允许的域名
function getCorsHeaders(env) {
  const allowedOrigin = env.FRONTEND_URL || 'https://piflea.com';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

// ============ 工具函数 ============

function jsonResponse(data, status = 200, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: getCorsHeaders(env),
  });
}

function errorResponse(message, status = 400, code = 'error', env) {
  return jsonResponse({ success: false, error: code, message }, status, env);
}

// 验证 Pi accessToken
async function verifyPiToken(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { _debug: 'No token provided' };
  }
  const head = token.slice(0, 5);
  const tail = token.slice(-5);
  console.log('[DEBUG my-orders] RECEIVE len=' + token.length + ' head=' + head + ' tail=' + tail);

  try {
    const res = await fetch(`${PLATFORM_API_URL}/v2/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      console.log('[DEBUG my-orders] /v2/me failed, status:', res.status, 'body:', text);
      return { _debug: 'v2/me status=' + res.status + ' body=' + text + ' | tokenLen=' + token.length + ' head=' + head + ' tail=' + tail };
    }
    const data = await res.json();
    console.log('[DEBUG my-orders] /v2/me success, full response:', JSON.stringify(data));
    const user = data.user || data;
    if (!user || !user.uid) {
      console.error('Invalid Pi user response', data);
      return null;
    }
    console.log('[DEBUG my-orders] verifyPiToken result - uid:', user?.uid, 'username:', user?.username);
    return user;
  } catch (e) {
    console.error('Token verify failed:', e.message);
    return { _debug: 'Exception: ' + e.message };
  }
}

// 需要鉴权的路由列表
const AUTH_REQUIRED_ROUTES = [
  '/api/transfer-to-seller',
  '/api/mark-shipped',
  '/api/my-orders',
  '/api/complete-order',
  '/api/create-order',
];

// 管理员 UID 白名单
const ADMIN_UIDS = ['01b4a2e0-f4b9-4a68-abcf-e0b879880707'];

// 调用 Pi Platform API（使用 Server API Key）
async function piPlatformRequest(path, method = 'GET', body = null, env) {
  const url = `${PLATFORM_API_URL}${path}`;
  const piApiKey = env.PI_API_KEY;
  const headers = {
    'Authorization': `Key ${piApiKey}`,
    'Content-Type': 'application/json',
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pi API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// 调用 Pi Platform API，返回原始错误信息（不抛异常）
async function piPlatformRequestRaw(path, method = 'GET', body = null, env) {
  const url = `${PLATFORM_API_URL}${path}`;
  const piApiKey = env.PI_API_KEY;
  const headers = {
    'Authorization': `Key ${piApiKey}`,
    'Content-Type': 'application/json',
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

// ============ Supabase 操作 ============
// 注意：这里用 fetch 直接调用 Supabase REST API
// 你也可以在 Workers 里用 @supabase/supabase-js

async function supabaseRequest(path, method, body, env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  const supabaseKey = env.SUPABASE_KEY;
  const url = `${supabaseUrl}/rest/v1${path}`;
  const headers = {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${path} failed: ${res.status} ${text}`);
  }
  if (method === 'GET' || method === 'PATCH' && headers['Prefer'].includes('return=representation')) {
    return res.json();
  }
  return null;
}

// ============ 状态兼容工具 ============
// 现有订单 status 可能是 'paid'，新逻辑用 'completed'
// 查询时兼容两者，更新时统一用 'completed'

function isCompleted(status) {
  return status === 'completed' || status === 'paid';
}

function isApproved(status) {
  return status === 'approved';
}

function isCancelled(status) {
  return status === 'cancelled';
}

// ============ 订单状态机 ============
// pending → approved → completed (或 paid)
// cancelled 独立分支

async function getOrderByPaymentId(paymentId, env) {
  const orders = await supabaseRequest(
    `/orders?payment_id=eq.${encodeURIComponent(paymentId)}&limit=1`,
    'GET', null, env
  );
  return orders && orders.length ? orders[0] : null;
}

async function createOrder(data, env) {
  return supabaseRequest('/orders', 'POST', data, env);
}

function generateOrderNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  for (let i = 0; i < 6; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'PF' + y + m + d + rand;
}

async function updateOrder(paymentId, updates, env) {
  return supabaseRequest(
    `/orders?payment_id=eq.${encodeURIComponent(paymentId)}`,
    'PATCH', updates, env
  );
}

// ============ 端点处理 ============

// 1. POST /api/approve - 批准支付（幂等）
async function handleApprove(request, env) {
  try {
    const body = await request.json();
    const { paymentId } = body;
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

    // 幂等性检查：同一 paymentId 已 approved 或 completed 则直接返回成功
    const existing = await getOrderByPaymentId(paymentId, env);
    if (existing) {
      if (isApproved(existing.status) || isCompleted(existing.status)) {
        return jsonResponse({
          success: true,
          message: `Payment ${paymentId} already ${existing.status}`,
          status: existing.status,
        }, 200, env);
      }
      if (isCancelled(existing.status)) {
        return errorResponse('Payment already cancelled', 400, 'already_cancelled', env);
      }
    }

    // 调用 Pi Platform API 获取支付详情
    let piMeta = {};
    let piAmount = 0;
    let piMemo = '';
    try {
      const payment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);
      piMeta = payment?.data?.metadata || {};
      piAmount = payment?.data?.amount?.value || 0;
      piMemo = payment?.data?.memo || '';
    } catch (e) {
      console.error('Pi API GET payment failed, using frontend data:', e.message);
    }

    // 优先用前端传来的数据，后备用 Pi API metadata
    const orderData = {
      payment_id: paymentId,
      order_no: generateOrderNo(),
      product_id: body.itemId || piMeta.itemId || piMeta.productId || null,
      buyer_id: body.buyerId || piMeta.buyerId || null,
      seller_id: body.sellerId || piMeta.sellerId || null,
      item_title: body.itemTitle || piMeta.itemTitle || '',
      item_price: body.itemPrice || piAmount || 0,
      amount: body.amount || piAmount || 0,
      memo: piMemo || body.memo || '',
      status: 'approved',
      txid: null,
      cancelled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      // 更新已有订单，补充缺失的字段（已有订单保持原逻辑，不做身份拦截）
      const updates = { status: 'approved', updated_at: new Date().toISOString() };
      if (!existing.buyer_id && orderData.buyer_id) updates.buyer_id = orderData.buyer_id;
      if (!existing.seller_id && orderData.seller_id) updates.seller_id = orderData.seller_id;
      if (!existing.item_title && orderData.item_title) updates.item_title = orderData.item_title;
      if ((!existing.item_price || existing.item_price == 0) && orderData.item_price) updates.item_price = orderData.item_price;
      await updateOrder(paymentId, updates, env);
    } else {
      // 新订单 INSERT 分支：身份字段强校验，防止空白订单
      let finalBuyerId = body.buyerId || piMeta.buyerId;
      let finalSellerId = body.sellerId || piMeta.sellerId;

      // 二次兜底：身份仍为空时，再调一次 Pi Platform API 取 metadata
      if (!finalBuyerId || !finalSellerId) {
        try {
          const retryPayment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);
          const retryMeta = retryPayment?.data?.metadata || {};
          if (!finalBuyerId && retryMeta.buyerId) finalBuyerId = retryMeta.buyerId;
          if (!finalSellerId && retryMeta.sellerId) finalSellerId = retryMeta.sellerId;
        } catch (e) {
          console.error('approve retry metadata fetch failed:', e.message);
        }
      }

      if (!finalBuyerId || !finalSellerId) {
        console.error('Missing buyer or seller identity', {
          paymentId,
          finalBuyerId,
          finalSellerId,
          body,
          piMeta,
        });
        return errorResponse('Missing buyer or seller identity', 400, 'missing_identity', env);
      }

      // 强校验通过，回填 orderData 后再 INSERT
      orderData.buyer_id = finalBuyerId;
      orderData.seller_id = finalSellerId;
      await createOrder(orderData, env);
    }

    // 调用 Pi Platform API approve
    await piPlatformRequest(`/v2/payments/${paymentId}/approve`, 'POST', {}, env);

    return jsonResponse({
      success: true,
      message: `Approved payment ${paymentId}`,
      status: 'approved',
    }, 200, env);
  } catch (err) {
    console.error('approve error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 2. POST /api/complete - 完成支付（幂等）
async function handleComplete(request, env) {
  try {
    const { paymentId, txid } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);
    if (!txid) return errorResponse('txid required', 400, 'missing_txid', env);

    // 幂等性检查
    const existing = await getOrderByPaymentId(paymentId, env);
    if (existing) {
      if (isCompleted(existing.status)) {
        return jsonResponse({
          success: true,
          message: `Payment ${paymentId} already completed`,
          status: 'completed',
          txid: existing.txid,
        }, 200, env);
      }
      if (isCancelled(existing.status)) {
        return errorResponse('Payment already cancelled', 400, 'already_cancelled', env);
      }
    } else {
      // 安全修复：无记录时不自动创建订单，返回 400 错误
      return errorResponse('Order not found', 400, 'order_not_found', env);
    }

    // 更新订单状态为 paid（等待卖家发货）
    const updates = {
      status: 'paid',
      txid,
      updated_at: new Date().toISOString(),
    };

    // 身份补偿：若 buyer_id / seller_id 等字段为空，重新从 Pi Platform metadata 读取补写
    if (!existing.buyer_id || !existing.seller_id || !existing.product_id || !existing.item_title) {
      try {
        const completePayment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);
        const completeMeta = completePayment?.data?.metadata || {};
        if (!existing.buyer_id && completeMeta.buyerId) updates.buyer_id = completeMeta.buyerId;
        if (!existing.seller_id && completeMeta.sellerId) updates.seller_id = completeMeta.sellerId;
        if (!existing.product_id && completeMeta.itemId) updates.product_id = completeMeta.itemId;
        if (!existing.item_title && completeMeta.itemTitle) updates.item_title = completeMeta.itemTitle;
      } catch (e) {
        console.error('complete metadata fetch failed:', e.message);
      }
    }

    await updateOrder(paymentId, updates, env);

    // 调用 Pi Platform API complete
    await piPlatformRequest(`/v2/payments/${paymentId}/complete`, 'POST', { txid }, env);

    return jsonResponse({
      success: true,
      message: `Completed payment ${paymentId}`,
      status: 'completed',
      txid,
    }, 200, env);
  } catch (err) {
    console.error('complete error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 3. POST /api/cancelled_payment - 取消支付（新增）
async function handleCancelled(request, env) {
  try {
    const { paymentId } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

    const existing = await getOrderByPaymentId(paymentId, env);

    if (existing) {
      // 已完成订单不能取消（兼容 paid）
      if (isCompleted(existing.status)) {
        return errorResponse('Cannot cancel completed payment', 400, 'already_completed', env);
      }
      // 已 approved 的订单取消时要释放库存
      if (isApproved(existing.status)) {
        // TODO: 实现库存释放逻辑
        // 示例：await releaseInventory(existing.product_id, existing.quantity);
        // 当前系统无库存管理，仅记录日志
        console.log(`[INVENTORY] Would release inventory for approved payment ${paymentId}, product: ${existing.product_id || 'N/A'}`);
      }
      // 更新为 cancelled
      await updateOrder(paymentId, {
        status: 'cancelled',
        cancelled: true,
        updated_at: new Date().toISOString(),
      }, env);
    } else {
      // 没有订单记录也创建一个 cancelled 记录，防止后续重复处理
      await createOrder({
        payment_id: paymentId,
        status: 'cancelled',
        cancelled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, env);
    }

    return jsonResponse({
      success: true,
      message: `Cancelled payment ${paymentId}`,
      status: 'cancelled',
    }, 200, env);
  } catch (err) {
    console.error('cancelled error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 4. POST /api/incomplete - 处理未完成支付（新增）
async function handleIncomplete(request, env) {
  try {
    const { payment, paymentId, txid, txURL } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

    const existing = await getOrderByPaymentId(paymentId, env);

    // 如果已经处理过（兼容 paid），直接返回
    if (existing && isCompleted(existing.status)) {
      return jsonResponse({
        success: true,
        message: `Payment ${paymentId} already completed`,
        status: 'completed',
      }, 200, env);
    }

    // 验证交易（如果有 txURL）
    let verifiedPaymentId = null;
    let horizonFailed = false;
    if (txURL) {
      try {
        const horizonRes = await fetch(txURL, { headers: { 'Accept': 'application/json' } });
        if (horizonRes.ok) {
          const horizonData = await horizonRes.json();
          verifiedPaymentId = horizonData.memo;
        } else {
          horizonFailed = true;
          console.warn('Horizon returned non-OK status:', horizonRes.status);
        }
      } catch (e) {
        horizonFailed = true;
        console.warn('Horizon verification failed:', e);
      }
    }

    // 安全修复：Horizon 失败时，用 Pi Platform API 二次确认
    if (horizonFailed || !verifiedPaymentId) {
      try {
        const piPayment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);
        if (piPayment && piPayment.data && piPayment.data.status && piPayment.data.status.developer_approved) {
          verifiedPaymentId = paymentId; // Platform API 确认支付存在且已批准
          console.log('Pi Platform API fallback verification passed for', paymentId);
        } else {
          return errorResponse('Payment verification failed', 400, 'verification_failed', env);
        }
      } catch (e) {
        console.error('Pi Platform API fallback verification failed:', e);
        return errorResponse('Payment verification failed', 400, 'verification_failed', env);
      }
    }

    // 验证 paymentId 匹配
    if (verifiedPaymentId && verifiedPaymentId !== paymentId) {
      return errorResponse('Payment ID mismatch', 400, 'mismatch', env);
    }

    // 更新或创建订单（统一用 'completed'）
    if (existing) {
      await updateOrder(paymentId, {
        status: 'completed',
        txid: txid || existing.txid,
        updated_at: new Date().toISOString(),
      }, env);
    } else {
      await createOrder({
        payment_id: paymentId,
        status: 'completed',
        txid: txid || null,
        cancelled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, env);
    }

    // 调用 Pi Platform API complete
    if (txid) {
      await piPlatformRequest(`/v2/payments/${paymentId}/complete`, 'POST', { txid }, env);
    }

    return jsonResponse({
      success: true,
      message: `Handled incomplete payment ${paymentId}`,
      status: 'completed',
      txid: txid || null,
    }, 200, env);
  } catch (err) {
    console.error('incomplete error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 5. GET /api/my-orders - 获取我的订单（已有，保持不变）
async function handleMyOrders(request, env) {
  try {
    const piUser = request.piUser;
    console.log('[DEBUG my-orders] request.piUser:', JSON.stringify(piUser));
    if (!piUser) {
      return errorResponse('Authentication required', 401, 'unauthorized', env);
    }
    const uid = piUser.uid;
    const url = new URL(request.url);
    const role = url.searchParams.get('role') || 'all';
    console.log('[DEBUG my-orders] uid:', uid, 'role:', role);

    if (!uid) return errorResponse('uid required', 400, 'missing_uid', env);

    let query = `/orders?`;
    if (role === 'buyer') {
      query += `buyer_id=eq.${encodeURIComponent(uid)}`;
    } else if (role === 'seller') {
      query += `seller_id=eq.${encodeURIComponent(uid)}`;
    } else {
      query += `or=(buyer_id.eq.${encodeURIComponent(uid)},seller_id.eq.${encodeURIComponent(uid)})`;
    }
    query += '&order=created_at.desc&limit=50';
    console.log('[DEBUG my-orders] Supabase query:', query);

    const orders = await supabaseRequest(query, 'GET', null, env);
    console.log('[DEBUG my-orders] Supabase result count:', orders ? orders.length : 0);

    return jsonResponse({
      success: true,
      data: orders || [],
    }, 200, env);
  } catch (err) {
    console.error('my-orders error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 6. POST /api/complete-order - 买家确认收货
async function handleCompleteOrder(request, env) {
  try {
    const { order_id, buyer_id } = await request.json();
    if (!order_id || !buyer_id) {
      return errorResponse('order_id and buyer_id required', 400, 'missing_params', env);
    }

    const orders = await supabaseRequest(
      `/orders?id=eq.${order_id}&buyer_id=eq.${encodeURIComponent(buyer_id)}&limit=1`,
      'GET', null, env
    );
    if (!orders || !orders.length) {
      return errorResponse('Order not found', 404, 'not_found', env);
    }

    await supabaseRequest(
      `/orders?id=eq.${order_id}`,
      'PATCH', { status: 'completed', updated_at: new Date().toISOString() }, env
    );

    return jsonResponse({ success: true, message: 'Order completed' }, 200, env);
  } catch (err) {
    console.error('complete-order error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 7. POST /api/mark-shipped - 卖家标记发货
async function handleMarkShipped(request, env) {
  try {
    const { order_id, shipping_company, tracking_no } = await request.json();
    const seller_id = request.piUser ? request.piUser.uid : null;
    if (!order_id || !seller_id) {
      return errorResponse('order_id required', 400, 'missing_params', env);
    }

    const orders = await supabaseRequest(
      `/orders?id=eq.${order_id}&seller_id=eq.${encodeURIComponent(seller_id)}&limit=1`,
      'GET', null, env
    );
    if (!orders || !orders.length) {
      return errorResponse('Order not found', 404, 'not_found', env);
    }

    // 修改 PATCH 更新，加入物流信息：
    const updateData = { status: 'shipped', updated_at: new Date().toISOString() };
    if (shipping_company) updateData.shipping_company = shipping_company;
    if (tracking_no) updateData.tracking_no = tracking_no;
    await supabaseRequest(`/orders?id=eq.${order_id}`, 'PATCH', updateData, env);

    return jsonResponse({ success: true, message: 'Order marked as shipped', shipping_company, tracking_no }, 200, env);
  } catch (err) {
    console.error('mark-shipped error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 8. POST /api/create-order - 前端创建订单（防御性去重：payment_id 已存在则直接返回）
async function handleCreateOrder(request, env) {
  try {
    const body = await request.json();
    const { payment_id, txid, buyer_id, seller_id, item_id, item_title, item_price, amount, memo } = body;

    // 去重保护：同一 payment_id 已有订单则直接返回，避免重复写入导致状态被覆盖
    if (payment_id) {
      const existing = await getOrderByPaymentId(payment_id, env);
      if (existing) {
        return jsonResponse({
          success: true,
          message: 'Order already exists',
          order_id: existing.id,
          status: existing.status,
        }, 200, env);
      }
    }

    const orderData = {
      payment_id: payment_id || null,
      buyer_id: buyer_id,
      seller_id: seller_id,
      product_id: item_id,
      item_title: item_title || '',
      item_price: item_price || 0,
      amount: amount || 0,
      memo: memo || '',
      status: 'pending',
      txid: txid || null,
      cancelled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await createOrder(orderData, env);
    return jsonResponse({ success: true, message: 'Order created' }, 200, env);
  } catch (err) {
    console.error('create-order error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// ============ A2U (App-to-User) 自动转账 ============
// 参考 Pi 官方 pi-nodejs SDK: https://github.com/pi-apps/pi-nodejs

function getPiHorizonConfig(networkPassphrase) {
  if (networkPassphrase === PI_HORIZON_MAINNET_PASSPHRASE) {
    return { url: PI_HORIZON_MAINNET_URL, passphrase: PI_HORIZON_MAINNET_PASSPHRASE };
  }
  return { url: PI_HORIZON_TESTNET_URL, passphrase: PI_HORIZON_TESTNET_PASSPHRASE };
}

// 9. POST /api/transfer-to-seller — A2U 自动转账给卖家
async function handleTransferToSeller(request, env) {
  try {
    const { order_id } = await request.json();
    if (!order_id) {
      return errorResponse('order_id required', 400, 'missing_params', env);
    }

    // 从验证后的 token 获取买家身份
    const buyer_id = request.piUser ? request.piUser.uid : null;
    if (!buyer_id) {
      return errorResponse('Authentication required', 401, 'unauthorized', env);
    }

    // 1. 查询订单（验证买家身份）
    const query = `/orders?id=eq.${order_id}&limit=1`;
    const orders = await supabaseRequest(query, 'GET', null, env);
    if (!orders || !orders.length) {
      return errorResponse('Order not found', 404, 'not_found', env);
    }
    const order = orders[0];

    // 在获取 order 后，验证 buyer_id 匹配
    if (order.buyer_id !== buyer_id) {
      return errorResponse('Only the buyer can confirm receipt', 403, 'forbidden', env);
    }

    // 金额上限校验（在获取 order 后）
    const transferAmount = parseFloat(order.amount) || 0;
    if (transferAmount > 1000) {
      return errorResponse('Transfer amount exceeds limit (1000 Pi)', 400, 'amount_exceeds_limit', env);
    }

    // 从订单记录中获取卖家 UID
    const seller_uid = order.seller_id;
    if (!seller_uid) {
      return errorResponse('Order has no seller_id, cannot transfer', 400, 'missing_seller_id', env);
    }

    // 2. 验证订单状态：必须是 shipped（已发货）才能确认收货并转账
    if (order.status !== 'shipped') {
      return errorResponse(
        `Order status is '${order.status}', must be 'shipped' to confirm receipt`,
        400, 'invalid_status', env
      );
    }

    // 3. 防重复：检查是否已经转账过
    if (order.a2u_txid) {
      return jsonResponse({
        success: true,
        message: 'Transfer already completed',
        a2u_payment_id: order.a2u_payment_id,
        a2u_txid: order.a2u_txid,
      }, 200, env);
    }

    // 4. 获取钱包私钥
    const walletPrivateSeed = env.WALLET_PRIVATE_SEED;
    if (!walletPrivateSeed) {
      return errorResponse('Wallet private seed not configured', 500, 'missing_wallet_seed', env);
    }

    // 5. 初始化密钥对
    const keypair = Keypair.fromSecret(walletPrivateSeed);
    console.log('[A2U] Keypair initialized, public key:', keypair.publicKey());

    // 6. 调用 Pi Platform API 创建 A2U 支付
    const paymentArgs = {
      amount: parseFloat(order.amount),
      memo: `Piflea: ${order.memo || '买家已确认收货'}`,
      metadata: {
        orderId: order.id,
        paymentId: order.payment_id,
        type: 'seller_payout',
      },
      uid: seller_uid,
    };
    console.log('[A2U] Creating payment for seller:', seller_uid, 'amount:', paymentArgs.amount);

    let a2uPaymentId;
    let paymentData;

    try {
      const a2uPayment = await piPlatformRequest(
        '/v2/payments',
        'POST',
        { payment: paymentArgs },
        env
      );
      a2uPaymentId = a2uPayment.identifier || a2uPayment.data?.identifier;
      console.log('[A2U] Payment created:', a2uPaymentId);

      // 获取 A2U 支付详情
      const a2uPaymentDetail = await piPlatformRequest(
        `/v2/payments/${a2uPaymentId}`,
        'GET', null, env
      );
      paymentData = a2uPaymentDetail.data || a2uPaymentDetail;
    } catch (createErr) {
      // 检测 ongoing_payment_found 错误
      const errMsg = createErr.message || '';
      if (errMsg.includes('ongoing_payment_found')) {
        console.log('[A2U] Ongoing payment found, trying to cancel and retry...');

        // 从错误信息中提取遗留支付的信息
        // 错误格式: Pi API /v2/payments failed: 400{"error":"ongoing_payment_found",...,"payment":{...,"identifier":"xxx",...}}
        let ongoingPaymentId = null;
        try {
          const jsonStart = errMsg.indexOf('{');
          if (jsonStart >= 0) {
            const jsonStr = errMsg.substring(jsonStart);
            const errObj = JSON.parse(jsonStr);
            ongoingPaymentId = errObj.payment?.identifier;
          }
        } catch (e) {
          console.error('[A2U] Failed to parse ongoing payment from error:', e);
        }

        if (ongoingPaymentId) {
          console.log('[A2U] Cancelling ongoing payment:', ongoingPaymentId);
          try {
            await piPlatformRequest(
              `/v2/payments/${ongoingPaymentId}/cancel`,
              'POST',
              {},
              env
            );
            console.log('[A2U] Ongoing payment cancelled, retrying...');
          } catch (cancelErr) {
            console.error('[A2U] Cancel failed:', cancelErr.message);
          }

          // 重新创建 A2U 支付
          const a2uPayment = await piPlatformRequest(
            '/v2/payments',
            'POST',
            { payment: paymentArgs },
            env
          );
          a2uPaymentId = a2uPayment.identifier || a2uPayment.data?.identifier;
          console.log('[A2U] Payment created after cancel:', a2uPaymentId);

          const a2uPaymentDetail = await piPlatformRequest(
            `/v2/payments/${a2uPaymentId}`,
            'GET', null, env
          );
          paymentData = a2uPaymentDetail.data || a2uPaymentDetail;
        } else {
          throw createErr;
        }
      } else {
        throw createErr;
      }
    }

    const fromAddress = paymentData.from_address;
    const toAddress = paymentData.to_address;
    const network = paymentData.network;

    // 安全校验：确认 from_address 与我们的公钥一致
    if (fromAddress !== keypair.publicKey()) {
      return errorResponse(
        'Wallet private seed does not match app wallet',
        500, 'private_seed_mismatch', env
      );
    }
    console.log('[A2U] From:', fromAddress, '→ To:', toAddress, 'Network:', network);

    // 8. 构建 Stellar 交易（用 fetch 直接调用 Horizon API）
    const horizonConfig = getPiHorizonConfig(network);
    const horizonUrl = horizonConfig.url;
    const publicKey = keypair.publicKey();

    // 8a. 加载账户（获取 sequence number）
    const accountRes = await fetch(`${horizonUrl}/accounts/${publicKey}`);
    if (!accountRes.ok) throw new Error('Failed to load account: ' + await accountRes.text());
    const accountData = await accountRes.json();
    const sourceAccount = new Account(publicKey, accountData.sequence);

    // 8b. 获取基础手续费
    const feeRes = await fetch(`${horizonUrl}/fee_stats`);
    const feeData = await feeRes.json();
    const baseFee = feeData.last_ledger_base_fee;

    // 8c. 获取时间边界
    const ledgerRes = await fetch(`${horizonUrl}/ledgers?order=desc&limit=1`);
    const ledgerData = await ledgerRes.json();
    const latestLedger = ledgerData._embedded.records[0];
    const now = Math.floor(Date.now() / 1000);
    const minTime = 0;
    const maxTime = now + PI_HORIZON_DEFAULT_TIMEBOUNDS;

    // 8d. 构建交易
    const transaction = new TransactionBuilder(sourceAccount, {
      fee: baseFee,
      networkPassphrase: horizonConfig.passphrase,
      timebounds: { minTime, maxTime },
    })
      .addOperation(Operation.payment({
        destination: toAddress,
        asset: Asset.native(), // Pi 是原生币
        amount: paymentData.amount.toString(),
      }))
      .addMemo(Memo.text(a2uPaymentId))
      .build();

    // 9. 签名交易
    transaction.sign(keypair);
    console.log('[A2U] Transaction signed, submitting to Pi blockchain...');

    // 10. 提交到 Pi 链（通过 Horizon REST API）
    const submitRes = await fetch(`${horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'tx=' + encodeURIComponent(transaction.toXDR()),
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) {
      throw new Error('Transaction submit failed: ' + JSON.stringify(submitData));
    }
    const a2uTxid = submitData.id || submitData.hash;
    console.log('[A2U] Transaction submitted, txid:', a2uTxid);

    // 11. 调用 Pi Platform API 完成 A2U 支付
    await piPlatformRequest(
      `/v2/payments/${a2uPaymentId}/complete`,
      'POST',
      { txid: a2uTxid },
      env
    );
    console.log('[A2U] Payment completed on Pi Platform');

    // 12. 更新订单状态
    await supabaseRequest(
      `/orders?id=eq.${order_id}`,
      'PATCH',
      {
        status: 'completed',
        a2u_payment_id: a2uPaymentId,
        a2u_txid: a2uTxid,
        updated_at: new Date().toISOString(),
      },
      env
    );

    return jsonResponse({
      success: true,
      message: 'Transfer to seller completed',
      a2u_payment_id: a2uPaymentId,
      a2u_txid: a2uTxid,
      amount: paymentData.amount,
      to_address: toAddress,
    }, 200, env);
  } catch (err) {
    console.error('[A2U] transfer-to-seller error:', err);
    return errorResponse(err.message, 500, 'transfer_failed', env);
  }
}

// ============ 路由分发 ============

export default {
  async fetch(request, env, ctx) {
    // CORS 预检处理
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(env) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 只处理 POST 和 GET 请求
    if (request.method !== 'POST' && request.method !== 'GET') {
      return errorResponse('Method not allowed', 405, 'method_not_allowed', env);
    }

    try {
      // 鉴权：需要 token 的路由
      if (AUTH_REQUIRED_ROUTES.includes(path)) {
        const piUser = await verifyPiToken(request, env);
        if (!piUser || piUser._debug) {
          const debugMsg = piUser?._debug || 'null result';
          return errorResponse('Unauthorized - invalid or missing token | DEBUG: ' + debugMsg, 401, 'unauthorized', env);
        }
        // 将验证后的用户信息附加到 request，供 handler 使用
        request.piUser = piUser;
      }

      switch (path) {
        case '/api/health':
          return jsonResponse({ success: true, message: 'Piflea backend is running!', status: 'ok' }, 200, env);
        case '/api/approve':
        case '/payments/approve':
          return await handleApprove(request, env);
        case '/api/complete':
        case '/payments/complete':
          return await handleComplete(request, env);
        case '/api/cancelled_payment':
        case '/payments/cancelled_payment':
          return await handleCancelled(request, env);
        case '/api/incomplete':
        case '/payments/incomplete':
          return await handleIncomplete(request, env);
        case '/api/create-order':
          return await handleCreateOrder(request, env);
        case '/api/complete-order':
          return await handleCompleteOrder(request, env);
        case '/api/mark-shipped':
          return await handleMarkShipped(request, env);
        case '/api/my-orders':
          return await handleMyOrders(request, env);
        case '/api/transfer-to-seller':
          return await handleTransferToSeller(request, env);
        default:
          return errorResponse('Not found', 404, 'not_found', env);
      }
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse('Internal server error', 500, 'internal_error', env);
    }
  },
};

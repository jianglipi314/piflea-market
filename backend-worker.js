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
// Pi Platform API 只有一个地址：api.minepi.com
// 主网/测试网由 Developer Portal 注册 app 时的 App Network 决定，不影响 API URL
const PLATFORM_API_URL = 'https://api.minepi.com';

function getPiApiUrl(network) {
  // 无论主网还是测试网，Pi Platform API 地址都是 api.minepi.com
  return PLATFORM_API_URL;
}

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
  // 收藏 API：身份从 Authorization Bearer token 获取，禁止前端传 userUid
  '/api/favorite',
  '/api/unfavorite',
  '/api/favorites',
  '/api/favorite-check',
  // 举报 API：身份从 Authorization Bearer token 获取，禁止前端传 reporter_uid
  '/api/report',
  // 管理员 API：所有 /api/admin/* 都需要 Pi token 解析 uid，handler 内再校验 ADMIN_UIDS
  '/api/admin/reports',
  '/api/admin/reports/review',
  '/api/admin/items/block',
  '/api/admin/items/unblock',
  '/api/admin/pending-transfers',
  '/api/admin/confirm-transfer',
];

// 管理员 UID 白名单
const ADMIN_UIDS = ['b0e1ca76-fa58-409f-a79c-60eab2a52250'];

// 管理员鉴权（所有 /api/admin/* 必须调用）
function requireAdmin(request) {
  const uid = request.piUser && request.piUser.uid;
  return !!(uid && ADMIN_UIDS.includes(uid));
}

// 调用 Pi Platform API（使用 Server API Key）
async function piPlatformRequest(path, method = 'GET', body = null, env, network = 'mainnet') {
  const apiUrl = getPiApiUrl(network);
  const url = `${apiUrl}${path}`;
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
    throw new Error(`Pi API ${path} failed (${network}): ${res.status} ${text}`);
  }
  return res.json();
}

// 调用 Pi Platform API，返回原始错误信息（不抛异常）
async function piPlatformRequestRaw(path, method = 'GET', body = null, env, network = 'mainnet') {
  const apiUrl = getPiApiUrl(network);
  const url = `${apiUrl}${path}`;
  const piApiKey = env.PI_API_KEY;
  const headers = {
    'Authorization': `Key ${piApiKey}`,
    'Content-Type': 'application/json',
  };
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text, network };
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

    // =========================================================
    // [APPROVE_START] 入口日志（验证前端发送过来的 body 是否完整）
    // =========================================================
    console.log('[APPROVE_START]', JSON.stringify({
      time: new Date().toISOString(),
      has_body: !!body,
      has_paymentId: !!paymentId,
      paymentId,
      body_keys: Object.keys(body || {}),
      body,
    }));

    // =========================================================
    // [APPROVE_ERROR] 统一错误日志（所有 return errorResponse 前调用一次）
    // 同时写入 Supabase orders 表，方便远程排查（Pi SDK 遮挡了前端 toast）
    // =========================================================
    async function debugApproveError(code, message, extra = {}) {
      console.error('[APPROVE_ERROR]', JSON.stringify({
        time: new Date().toISOString(),
        code,
        message,
        ...extra,
      }));
      // 写入数据库，status='approve_error'，item_title 记录错误码
      try {
        await supabaseRequest('/orders', 'POST', {
          payment_id: extra.paymentId || ('debug_' + Date.now()),
          order_no: 'ERR_' + Date.now(),
          product_id: extra.productId || 0,
          buyer_id: extra.finalBuyerId || null,
          seller_id: extra.finalSellerId || null,
          item_title: `[${code}] ${message}`.slice(0, 200),
          item_price: 0,
          shipping_fee: 0,
          expected_amount: 0,
          amount: 0,
          memo: JSON.stringify(extra).slice(0, 500),
          status: 'approve_error',
          txid: null,
          cancelled: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, env);
        console.log('[APPROVE_ERROR] Written to Supabase orders table');
      } catch (dbErr) {
        console.error('[APPROVE_ERROR] Failed to write to Supabase:', dbErr.message);
      }
    }

    if (!paymentId) {
      await debugApproveError('missing_payment_id', 'paymentId required', {
        body,
        body_keys: Object.keys(body || {}),
      });
      return errorResponse('paymentId required', 400, 'missing_payment_id', env);
    }

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
        await debugApproveError('already_cancelled', 'Payment already cancelled', {
          paymentId,
          existing_status: existing.status,
          existing_order_id: existing.id,
        });
        return errorResponse('Payment already cancelled', 400, 'already_cancelled', env);
      }
    }

    // 调用 Pi Platform API 验证支付真实性并获取详情
    // Pi Platform API 地址统一为 api.minepi.com，主网/测试网通用
    let payment;
    try {
      payment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);
      console.log('[APPROVE_NETWORK]', `Payment verified via api.minepi.com`, { paymentId });
    } catch (e) {
      console.error('Pi API GET payment failed:', e.message);
      await debugApproveError('payment_verification_failed', 'Failed to verify payment: ' + e.message, {
        paymentId,
        error_message: e.message,
        error_stack: e.stack ? e.stack.slice(0, 500) : undefined,
      });
      return errorResponse('Failed to verify payment: ' + e.message, 400, 'payment_verification_failed', env);
    }

    // Pi API 返回格式兼容：可能 { data: {...} } 或直接 {...}
    const piData = payment?.data || payment || {};
    const piMeta = piData.metadata || {};
    const piAmount = piData.amount?.value ?? piData.amount ?? 0;
    const piMemo = piData.memo || '';

    // =========================================================
    // [PI_PAYMENT_DATA] Pi Platform 返回的真实支付对象 & metadata
    // =========================================================
    console.log('[PI_PAYMENT_DATA]', JSON.stringify({
      payment_top_keys: payment ? Object.keys(payment) : null,
      piData_keys: Object.keys(piData),
      identifier: piData.identifier,
      status: piData.status,
      amount: piData.amount,
      amount_type: typeof piData.amount,
      amount_keys: piData.amount ? Object.keys(piData.amount) : null,
      piAmount_parsed: piAmount,
      memo: piMemo,
      metadata_keys: Object.keys(piMeta || {}),
      metadata: piMeta,
      userUid: piData.user?.uid,
      full_payment: JSON.stringify(payment).slice(0, 1500),
    }));

    // ===== 资金安全校验：商品金额快照 =====
    const productId = piMeta.itemId || piMeta.productId || body.itemId || null;
    let itemPriceSnapshot = 0;
    let shippingFeeSnapshot = 0;
    let expectedAmount = 0;

    // 1. product_id 必须存在
    if (!productId) {
      console.error('SECURITY: Missing product_id in payment metadata', { paymentId, piMeta });
      await debugApproveError('missing_product_id', 'Missing product_id', {
        paymentId,
        piMeta,
        body_itemId: body.itemId,
        body_productId: body.productId,
        body_keys: Object.keys(body || {}),
      });
      return errorResponse('Missing product_id', 400, 'missing_product_id', env);
    }

    // 2. 查询 items 表获取真实商品信息（可信来源）
    let item;
    try {
      const items = await supabaseRequest(
        `/items?id=eq.${productId}&limit=1&select=price,shipping_fee,owner_id,status`,
        'GET', null, env
      );
      if (!items || !items.length) {
        console.error('SECURITY: Product not found', { paymentId, productId });
        await debugApproveError('product_not_found', 'Product not found', {
          paymentId,
          productId,
          productId_type: typeof productId,
          piMeta_itemId: piMeta?.itemId,
          piMeta_productId: piMeta?.productId,
          body_itemId: body?.itemId,
        });
        return errorResponse('Product not found', 404, 'product_not_found', env);
      }
      item = items[0];

      // =========================================================
      // [ITEM_VERIFY] items 表可信快照（price/运费/owner/status + parseFloat 检查）
      // =========================================================
      console.log('[ITEM_VERIFY]', JSON.stringify({
        productId,
        productId_type: typeof productId,
        item: {
          id: item.id,
          price: item.price,
          shipping_fee: item.shipping_fee,
          owner_id: item.owner_id,
          status: item.status,
        },
        parse_itemPrice: parseFloat(item.price),
        parse_itemPrice_isNaN: isNaN(parseFloat(item.price)),
        parse_shippingFee: parseFloat(item.shipping_fee),
        parse_shippingFee_isNaN: isNaN(parseFloat(item.shipping_fee)),
      }));
    } catch (e) {
      console.error('Failed to query product for verification:', e.message);
      await debugApproveError('price_verification_failed', 'Unable to verify product price', {
        paymentId,
        productId,
        error_message: e.message,
        error_stack: e.stack ? e.stack.slice(0, 500) : undefined,
      });
      return errorResponse('Unable to verify product price', 500, 'price_verification_failed', env);
    }

    // 3. 验证商品状态
    if (item.status !== 'active') {
      console.error('SECURITY: Product unavailable', { paymentId, productId, status: item.status });
      await debugApproveError('product_unavailable', 'Product unavailable', {
        paymentId,
        productId,
        item_status: item.status,
        item,
      });
      return errorResponse('Product unavailable', 400, 'product_unavailable', env);
    }

    // 4. 验证 seller_id 一致性
    if (item.owner_id && piMeta.sellerId && item.owner_id !== piMeta.sellerId) {
      console.error('SECURITY: Seller mismatch', {
        paymentId,
        itemOwner: item.owner_id,
        metaSellerId: piMeta.sellerId,
      });
      await debugApproveError('seller_mismatch', 'Seller mismatch', {
        paymentId,
        productId,
        item_owner_id: item.owner_id,
        piMeta_sellerId: piMeta.sellerId,
        body_sellerId: body?.sellerId,
        piMeta,
      });
      return errorResponse('Seller mismatch', 400, 'seller_mismatch', env);
    }

    // 5. 计算 expected_amount
    itemPriceSnapshot = parseFloat(item.price) || 0;
    shippingFeeSnapshot = parseFloat(item.shipping_fee) || 0;
    expectedAmount = itemPriceSnapshot + shippingFeeSnapshot;

    // 6. Pi amount 有效性检查（禁止 0 金额订单）
    if (!piAmount || piAmount <= 0) {
      console.error('SECURITY: Invalid payment amount', { paymentId, piAmount });
      await debugApproveError('invalid_amount', 'Invalid payment amount', {
        paymentId,
        piAmount,
        piAmount_type: typeof piAmount,
        raw_amount: piData.amount,
        raw_amount_type: typeof piData.amount,
        raw_piData: JSON.stringify(piData).slice(0, 1000),
        raw_payment: JSON.stringify(payment).slice(0, 1500),
        payment_top_keys: payment ? Object.keys(payment) : null,
      });
      return errorResponse('Invalid payment amount', 400, 'invalid_amount', env);
    }

    // 7. 金额一致性校验（Pi API 返回的真实支付金额 vs 商品预期金额）
    // =========================================================
    // [AMOUNT_CHECK] 金额比较四要素（判断前打印，便于排查 will_fail）
    // =========================================================
    console.log('[AMOUNT_CHECK]', JSON.stringify({
      piAmount,
      expectedAmount,
      diff: Math.abs(piAmount - expectedAmount),
      tolerance: 0.0001,
      itemPriceSnapshot,
      shippingFeeSnapshot,
      will_fail: Math.abs(piAmount - expectedAmount) > 0.0001,
    }));
    if (Math.abs(piAmount - expectedAmount) > 0.0001) {
      console.error('SECURITY: Amount mismatch', {
        paymentId,
        piAmount,
        expectedAmount,
        itemPrice: itemPriceSnapshot,
        shippingFee: shippingFeeSnapshot,
        productId,
      });
      await debugApproveError('amount_mismatch',
        `Payment amount ${piAmount} does not match expected ${expectedAmount}`,
        {
          paymentId,
          productId,
          piAmount,
          expectedAmount,
          diff: Math.abs(piAmount - expectedAmount),
          tolerance: 0.0001,
          itemPrice: itemPriceSnapshot,
          shippingFee: shippingFeeSnapshot,
          piMeta,
          body_itemId: body.itemId,
          body_amount: body.amount,
        });
      return errorResponse(
        `Payment amount ${piAmount} does not match expected ${expectedAmount}`,
        400, 'amount_mismatch', env
      );
    }
    // ===== 资金安全校验结束 =====

    // 优先使用 Pi API 返回的 metadata，不信任前端关键字段
    // 金额字段必须使用可信来源：item_price/shipping_fee/expected_amount 来自 items 表，amount 来自 Pi API
    const orderData = {
      payment_id: paymentId,
      order_no: generateOrderNo(),
      product_id: productId,
      buyer_id: piMeta.buyerId || body.buyerId || null,
      seller_id: piMeta.sellerId || body.sellerId || null,
      item_title: piMeta.itemTitle || body.itemTitle || '',
      item_price: itemPriceSnapshot,
      shipping_fee: shippingFeeSnapshot,
      expected_amount: expectedAmount,
      amount: piAmount,
      memo: piMemo || body.memo || '',
      // 收货信息（从 Pi payment metadata 读取，前端通过 createPiPayment 传入）
      receiver_name: piMeta.receiverName || body.receiverName || null,
      receiver_phone: piMeta.receiverPhone || body.receiverPhone || null,
      receiver_address: piMeta.receiverAddress || body.receiverAddress || null,
      buyer_note: piMeta.buyerNote || body.buyerNote || null,
      status: 'pending_approve',
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
      const finalBuyerId = piMeta.buyerId || body.buyerId || null;
      const finalSellerId = piMeta.sellerId || body.sellerId || null;

      if (!finalBuyerId || !finalSellerId) {
        console.error('Missing buyer or seller identity', {
          paymentId,
          finalBuyerId,
          finalSellerId,
          body,
          piMeta,
        });
        await debugApproveError('missing_identity', 'Missing buyer or seller identity', {
          paymentId,
          finalBuyerId,
          finalSellerId,
          piMeta_buyerId: piMeta?.buyerId,
          body_buyerId: body?.buyerId,
          piMeta_sellerId: piMeta?.sellerId,
          body_sellerId: body?.sellerId,
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
    try {
      await piPlatformRequest(`/v2/payments/${paymentId}/approve`, 'POST', {}, env);
    } catch (approveErr) {
      // Pi approve 失败，更新订单状态为 approve_failed，方便后续人工排查
      console.error('Pi approve failed after order creation', {
        paymentId,
        productId,
        amount: piAmount,
        error: approveErr.message,
      });
      try {
        await updateOrder(paymentId, {
          status: 'approve_failed',
          updated_at: new Date().toISOString(),
        }, env);
      } catch (updateErr) {
        console.error('Failed to update order status to approve_failed', {
          paymentId,
          error: updateErr.message,
        });
      }
      throw approveErr;
    }

    // Pi approve 成功，更新订单状态为 approved
    try {
      await updateOrder(paymentId, {
        status: 'approved',
        updated_at: new Date().toISOString(),
      }, env);
    } catch (updateErr) {
      console.error('Failed to update order status to approved', {
        paymentId,
        error: updateErr.message,
      });
      throw updateErr;
    }

    return jsonResponse({
      success: true,
      message: `Approved payment ${paymentId}`,
      status: 'approved',
    }, 200, env);
  } catch (err) {
    console.error('approve error:', err);
    // 兜底错误统一走 [APPROVE_ERROR]，便于 wrangler tail 搜索
    console.error('[APPROVE_ERROR]', JSON.stringify({
      time: new Date().toISOString(),
      code: 'internal_error',
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack).slice(0, 1500) : undefined,
      // 把当前作用域内已知字段 dump 出来（try 内块级作用域取不到，仅提供入口级上下文）
      req_body: typeof body !== 'undefined' ? body : undefined,
      req_paymentId: typeof paymentId !== 'undefined' ? paymentId : undefined,
    }));
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
      // 幂等状态：paid / shipped / completed 都已完成支付，直接返回成功
      if (
        existing.status === 'paid' ||
        existing.status === 'shipped' ||
        existing.status === 'completed'
      ) {
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
      // 状态机校验：只有 approved 状态才能进入 complete
      if (existing.status !== 'approved') {
        console.error('SECURITY: Invalid status for complete', {
          paymentId,
          currentStatus: existing.status,
        });
        return errorResponse(
          'Order not ready for completion',
          400, 'invalid_status', env
        );
      }
    } else {
      // 安全修复：无记录时不自动创建订单，返回 400 错误
      return errorResponse('Order not found', 400, 'order_not_found', env);
    }

    // 先调用 Pi Platform API 获取支付详情，验证 paymentId 和 txid 关联关系
    let piPayment;
    try {
      piPayment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);
    } catch (e) {
      console.error('Pi API GET payment failed in complete:', e.message);
      return errorResponse('Failed to verify payment: ' + e.message, 400, 'payment_verification_failed', env);
    }

    const piTxid = piPayment?.data?.transaction?.txid
      || piPayment?.data?.transaction_info?.txid
      || piPayment?.data?.txid
      || null;

    // 验证 txid 与 paymentId 关联
    if (piTxid && txid !== piTxid) {
      console.error('txid mismatch', { paymentId, providedTxid: txid, piTxid });
      return errorResponse('txid does not match payment', 400, 'txid_mismatch', env);
    }

    // 先调用 Pi Platform API complete，成功后再更新本地订单
    await piPlatformRequest(`/v2/payments/${paymentId}/complete`, 'POST', { txid }, env);

    // 更新订单状态为 paid（等待卖家发货）
    const updates = {
      status: 'paid',
      txid: piTxid || txid,
      updated_at: new Date().toISOString(),
    };

    // 身份补偿：若 buyer_id / seller_id 等字段为空，从 Pi Platform metadata 读取补写
    const completeMeta = piPayment?.data?.metadata || {};
    if (!existing.buyer_id && completeMeta.buyerId) updates.buyer_id = completeMeta.buyerId;
    if (!existing.seller_id && completeMeta.sellerId) updates.seller_id = completeMeta.sellerId;
    if (!existing.product_id && completeMeta.itemId) updates.product_id = completeMeta.itemId;
    if (!existing.item_title && completeMeta.itemTitle) updates.item_title = completeMeta.itemTitle;

    await updateOrder(paymentId, updates, env);

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
          verifiedPaymentId = paymentId;
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

// ============ 收藏 API ============
// 身份来源：Authorization Bearer token → verifyPiToken → request.piUser.uid
// 禁止前端传 userUid，统一从 request.piUser 取
// 收藏真实数据只来自 favorites 表，不维护 items.fav_count

// 5.1 POST /api/favorite - 收藏商品（幂等，UNIQUE 约束兜底）
async function handleFavorite(request, env) {
  try {
    const piUser = request.piUser;
    if (!piUser || !piUser.uid) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401, env);
    }
    const uid = piUser.uid;
    const { itemId } = await request.json();
    if (!itemId) {
      return jsonResponse({ success: false, error: 'itemId required' }, 400, env);
    }

    // 校验商品存在（不限制 status，已下架也可保留收藏关系）
    const items = await supabaseRequest(
      `/items?id=eq.${encodeURIComponent(itemId)}&select=id&limit=1`,
      'GET', null, env
    );
    if (!items || !items.length) {
      return jsonResponse({ success: false, error: 'Item not found' }, 404, env);
    }

    // INSERT，利用 UNIQUE(user_uid, item_id) 天然幂等
    try {
      await supabaseRequest('/favorites', 'POST', {
        user_uid: uid,
        item_id: itemId,
      }, env);
    } catch (e) {
      // 409 = 已存在，视为成功（幂等）
      if (!String(e.message || '').includes('409')) {
        throw e;
      }
    }

    return jsonResponse({ success: true, data: { favorited: true } }, 200, env);
  } catch (err) {
    console.error('favorite error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 5.2 POST /api/unfavorite - 取消收藏（幂等，不存在也返回成功）
async function handleUnfavorite(request, env) {
  try {
    const piUser = request.piUser;
    if (!piUser || !piUser.uid) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401, env);
    }
    const uid = piUser.uid;
    const { itemId } = await request.json();
    if (!itemId) {
      return jsonResponse({ success: false, error: 'itemId required' }, 400, env);
    }

    await supabaseRequest(
      `/favorites?user_uid=eq.${encodeURIComponent(uid)}&item_id=eq.${encodeURIComponent(itemId)}`,
      'DELETE', null, env
    );

    return jsonResponse({ success: true, data: { favorited: false } }, 200, env);
  } catch (err) {
    console.error('unfavorite error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 5.3 GET /api/favorites - 我的收藏列表（两步查询，避免 PostgREST 关联风险）
async function handleFavorites(request, env) {
  try {
    const piUser = request.piUser;
    if (!piUser || !piUser.uid) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401, env);
    }
    const uid = piUser.uid;

    // 步骤 1：查 favorites 获取 item_id 列表（按收藏时间倒序）
    const favs = await supabaseRequest(
      `/favorites?user_uid=eq.${encodeURIComponent(uid)}&select=item_id,created_at&order=created_at.desc&limit=100`,
      'GET', null, env
    );
    if (!favs || !favs.length) {
      return jsonResponse({ success: true, data: [] }, 200, env);
    }

    // 步骤 2：批量查 items 详情（用 in 过滤）
    const itemIds = favs.map((f) => f.item_id);
    const inExpr = `(${itemIds.map((id) => encodeURIComponent(id)).join(',')})`;
    const items = await supabaseRequest(
      `/items?id=in.${inExpr}&limit=100`,
      'GET', null, env
    );

    // 按 favorites 的收藏顺序排序输出
    // 用 String() 统一 key 类型，避免 number/string 不匹配导致 Map.get 失败
    const itemMap = new Map((items || []).map((it) => [String(it.id), it]));
    const ordered = favs
      .map((f) => itemMap.get(String(f.item_id)))
      .filter(Boolean);

    return jsonResponse({ success: true, data: ordered }, 200, env);
  } catch (err) {
    console.error('favorites error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 5.4 GET /api/favorite-check?itemId=X - 检查当前用户是否已收藏某商品
async function handleFavoriteCheck(request, env) {
  try {
    const piUser = request.piUser;
    if (!piUser || !piUser.uid) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401, env);
    }
    const uid = piUser.uid;
    const url = new URL(request.url);
    const itemId = url.searchParams.get('itemId');
    if (!itemId) {
      return jsonResponse({ success: false, error: 'itemId required' }, 400, env);
    }

    const rows = await supabaseRequest(
      `/favorites?user_uid=eq.${encodeURIComponent(uid)}&item_id=eq.${encodeURIComponent(itemId)}&select=id&limit=1`,
      'GET', null, env
    );

    return jsonResponse({
      success: true,
      data: { favorited: !!(rows && rows.length) },
    }, 200, env);
  } catch (err) {
    console.error('favorite-check error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 6. POST /api/report - 用户提交举报（保留历史，不设 UNIQUE，允许同一用户多次举报）
async function handleReport(request, env) {
  try {
    const piUser = request.piUser;
    if (!piUser || !piUser.uid) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401, env);
    }
    const reporterUid = piUser.uid;

    const body = await request.json();
    const itemId = body.itemId;
    const reason = body.reason;
    const detail = body.detail ? String(body.detail).slice(0, 500) : null;

    // 参数校验
    if (!itemId) {
      return jsonResponse({ success: false, error: 'itemId required' }, 400, env);
    }
    const ALLOWED_REASONS = ['虚假描述', '违禁品', '涉嫌诈骗', '其他'];
    if (!ALLOWED_REASONS.includes(reason)) {
      return jsonResponse({ success: false, error: 'invalid reason' }, 400, env);
    }

    // 校验商品存在（不限制 status，已下架商品也可举报）
    const items = await supabaseRequest(
      `/items?id=eq.${encodeURIComponent(itemId)}&select=id&limit=1`,
      'GET', null, env
    );
    if (!items || !items.length) {
      return jsonResponse({ success: false, error: 'Item not found' }, 404, env);
    }

    // 写入 reports（Worker 用 service_role key，绕过 RLS；reports 表未开放 INSERT policy）
    await supabaseRequest('/reports', 'POST', {
      reporter_uid: reporterUid,
      item_id: itemId,
      reason: reason,
      detail: detail,
      status: 'pending',
    }, env);

    return jsonResponse({ success: true, data: { reported: true } }, 200, env);
  } catch (err) {
    console.error('report error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// ============ 管理员 API ============
// 所有 /api/admin/* 路由：
// 1. 已在 AUTH_REQUIRED_ROUTES，verifyPiToken 解析后 request.piUser.uid 可用
// 2. handler 内调用 requireAdmin(request) 校验 ADMIN_UIDS 白名单
// 3. 非管理员一律 403，不泄露任何数据

// 8. GET /api/admin/reports - 举报队列（支持 status 筛选）
async function handleAdminReports(request, env) {
  if (!requireAdmin(request)) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403, env);
  }
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending'; // pending / reviewed / dismissed / all

    // 两步查询：先查 reports，再批量查 items 标题（避免 PostgREST 关联风险）
    let filter = '';
    if (status !== 'all') {
      filter = `&status=eq.${encodeURIComponent(status)}`;
    }
    const reports = await supabaseRequest(
      `/reports?order=created_at.desc&limit=200${filter}`,
      'GET', null, env
    );

    const list = reports || [];
    if (list.length === 0) {
      return jsonResponse({ success: true, data: [] }, 200, env);
    }

    // 批量查询对应商品标题和当前状态
    const itemIds = [...new Set(list.map(r => r.item_id))];
    const items = await supabaseRequest(
      `/items?id=in.(${itemIds.join(',')})&select=id,title,status,owner_id`,
      'GET', null, env
    );
    const itemMap = new Map();
    (items || []).forEach(it => itemMap.set(it.id, it));

    // 第 3 步：查询所有举报的 item_id（不限 status），统计每商品总举报次数 → 计算风险等级
    // risk_level: count >= 3 → high, count === 2 → medium, 否则 normal
    let countMap = new Map();
    try {
      const allReports = await supabaseRequest(
        `/reports?select=item_id&limit=1000`,
        'GET', null, env
      );
      (allReports || []).forEach(r => {
        const id = r.item_id;
        countMap.set(id, (countMap.get(id) || 0) + 1);
      });
    } catch (e) {
      console.error('report count query failed:', e.message);
      // 统计失败不阻断主流程，所有 report_count 默认 1
    }

    const data = list.map(r => {
      const it = itemMap.get(r.item_id) || {};
      const reportCount = countMap.get(r.item_id) || 1;
      const riskLevel = reportCount >= 3 ? 'high' : (reportCount === 2 ? 'medium' : 'normal');
      return {
        id: r.id,
        item_id: r.item_id,
        item_title: it.title || '(商品已删除)',
        item_status: it.status || 'unknown',
        item_owner_id: it.owner_id || null,
        reason: r.reason,
        detail: r.detail || '',
        status: r.status,
        reporter_uid: r.reporter_uid,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at || null,
        reviewed_by: r.reviewed_by || null,
        admin_note: r.admin_note || '',
        report_count: reportCount,
        risk_level: riskLevel,
      };
    });

    return jsonResponse({ success: true, data }, 200, env);
  } catch (err) {
    console.error('admin reports error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 9. POST /api/admin/reports/review - 处理举报（标记 reviewed/dismissed）
async function handleAdminReportReview(request, env) {
  if (!requireAdmin(request)) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403, env);
  }
  try {
    const body = await request.json();
    const { reportId, action, note } = body;
    if (!reportId || !action) {
      return jsonResponse({ success: false, error: 'reportId and action required' }, 400, env);
    }
    if (action !== 'reviewed' && action !== 'dismissed') {
      return jsonResponse({ success: false, error: 'action must be reviewed or dismissed' }, 400, env);
    }

    const adminUid = request.piUser.uid;
    const updates = {
      status: action,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminUid,
      admin_note: note ? String(note).slice(0, 500) : null,
    };

    await supabaseRequest(
      `/reports?id=eq.${encodeURIComponent(reportId)}`,
      'PATCH', updates, env
    );

    return jsonResponse({ success: true, data: { id: reportId, status: action } }, 200, env);
  } catch (err) {
    console.error('admin report review error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 10. POST /api/admin/items/block - 下架商品（items.status = 'blocked'）
async function handleAdminItemBlock(request, env) {
  if (!requireAdmin(request)) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403, env);
  }
  try {
    const body = await request.json();
    const { itemId } = body;
    if (!itemId) {
      return jsonResponse({ success: false, error: 'itemId required' }, 400, env);
    }

    await supabaseRequest(
      `/items?id=eq.${encodeURIComponent(itemId)}`,
      'PATCH', { status: 'blocked' }, env
    );

    console.log('[ADMIN] item blocked', { itemId, admin: request.piUser.uid });
    return jsonResponse({ success: true, data: { id: itemId, status: 'blocked' } }, 200, env);
  } catch (err) {
    console.error('admin item block error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 11. POST /api/admin/items/unblock - 恢复商品（items.status = 'active'）
async function handleAdminItemUnblock(request, env) {
  if (!requireAdmin(request)) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403, env);
  }
  try {
    const body = await request.json();
    const { itemId } = body;
    if (!itemId) {
      return jsonResponse({ success: false, error: 'itemId required' }, 400, env);
    }

    await supabaseRequest(
      `/items?id=eq.${encodeURIComponent(itemId)}`,
      'PATCH', { status: 'active' }, env
    );

    console.log('[ADMIN] item unblocked', { itemId, admin: request.piUser.uid });
    return jsonResponse({ success: true, data: { id: itemId, status: 'active' } }, 200, env);
  } catch (err) {
    console.error('admin item unblock error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 12. GET /api/admin/pending-transfers - 待转账订单（补全缺失的现有 API）
async function handleAdminPendingTransfers(request, env) {
  if (!requireAdmin(request)) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403, env);
  }
  try {
    // 待转账 = 已支付但未转账给卖家（status=approved，无 a2u_txid）
    const orders = await supabaseRequest(
      `/orders?status=eq.approved&order=id.desc&limit=100&select=id,order_no,item_title,item_price,amount,seller_id,buyer_id,created_at`,
      'GET', null, env
    );
    return jsonResponse({ success: true, data: orders || [] }, 200, env);
  } catch (err) {
    console.error('admin pending-transfers error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 13. POST /api/admin/confirm-transfer - 确认已转账（补全缺失的现有 API）
async function handleAdminConfirmTransfer(request, env) {
  if (!requireAdmin(request)) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403, env);
  }
  try {
    const body = await request.json();
    const { order_id } = body;
    if (!order_id) {
      return jsonResponse({ success: false, error: 'order_id required' }, 400, env);
    }

    // 标记订单为已完成（管理员手动确认转账）
    await supabaseRequest(
      `/orders?id=eq.${encodeURIComponent(order_id)}`,
      'PATCH', {
        status: 'completed',
        updated_at: new Date().toISOString(),
      }, env
    );

    console.log('[ADMIN] transfer confirmed', { order_id, admin: request.piUser.uid });
    return jsonResponse({ success: true, data: { id: order_id, status: 'completed' } }, 200, env);
  } catch (err) {
    console.error('admin confirm-transfer error:', err);
    return jsonResponse({ success: false, error: err.message }, 500, env);
  }
}

// 7. POST /api/complete-order - 买家确认收货
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

    const order = orders[0];

    if (order.status !== 'paid') {
      return errorResponse(
        `Order status is '${order.status}', must be 'paid' to ship`,
        400, 'invalid_status', env
      );
    }

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
    const { payment_id, txid, buyer_id, seller_id, item_id, item_title, item_price, amount, memo,
            receiverName, receiverPhone, receiverAddress, buyerNote } = body;

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
      // 收货信息（兼容字段，前端当前不调用此接口）
      receiver_name: receiverName || null,
      receiver_phone: receiverPhone || null,
      receiver_address: receiverAddress || null,
      buyer_note: buyerNote || null,
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

    // 3a. 恢复检查：a2u_payment_id 存在但 a2u_txid 为空
    //     说明 payment 已创建，可能转账已完成但 DB 最终更新失败
    let recoveredPaymentId = null;
    let recoveredPaymentData = null;
    if (order.a2u_payment_id) {
      console.log('[A2U_RECOVERY] Found existing a2u_payment_id without txid', {
        order_id: order.id,
        a2u_payment_id: order.a2u_payment_id,
      });
      try {
        const recoveryDetail = await piPlatformRequest(
          `/v2/payments/${order.a2u_payment_id}`,
          'GET', null, env
        );
        const recoveryData = recoveryDetail.data || recoveryDetail;
        const recoveryStatus = recoveryData?.status?.developer_completed
          || recoveryData?.status?.transaction_verified
          || recoveryData?.transaction?.txid
          ? 'completed' : 'pending';
        console.log('[A2U_RECOVERY] Pi payment status', {
          order_id: order.id,
          a2u_payment_id: order.a2u_payment_id,
          paymentStatus: recoveryStatus,
          rawStatus: JSON.stringify(recoveryData?.status || {}),
        });

        if (recoveryStatus === 'completed') {
          // payment 已完成，补全 a2u_txid
          const recoveredTxid = recoveryData?.transaction?.txid
            || recoveryData?.transaction_info?.txid
            || recoveryData?.txid
            || null;
          if (recoveredTxid) {
            console.log('[A2U_RECOVERY] Recovering completed transfer', {
              order_id: order.id,
              a2u_payment_id: order.a2u_payment_id,
              recoveredTxid,
            });
            try {
              await supabaseRequest(
                `/orders?id=eq.${order.id}`,
                'PATCH',
                {
                  status: 'completed',
                  a2u_txid: recoveredTxid,
                  updated_at: new Date().toISOString(),
                },
                env
              );
            } catch (updateErr) {
              console.error('[A2U_RECOVERY] Failed to update order after recovery', {
                order_id: order.id,
                error: updateErr.message,
              });
            }
            return jsonResponse({
              success: true,
              message: 'Transfer recovered (already completed on Pi)',
              a2u_payment_id: order.a2u_payment_id,
              a2u_txid: recoveredTxid,
              recovered: true,
            }, 200, env);
          } else {
            // payment 已完成但无法提取 txid，记录告警，不重复转账
            console.error('[A2U_RECOVERY] Payment completed but txid not found, SKIP re-transfer', {
              order_id: order.id,
              a2u_payment_id: order.a2u_payment_id,
            });
            return errorResponse(
              'Transfer already completed on Pi but txid missing. Manual review required.',
              409, 'recovery_requires_manual_review', env
            );
          }
        } else {
          // payment 未完成，复用已有 payment 继续未完成的流程（不创建新 payment）
          console.log('[A2U_RECOVERY] Payment not completed, reusing existing payment', {
            order_id: order.id,
            a2u_payment_id: order.a2u_payment_id,
          });
          recoveredPaymentId = order.a2u_payment_id;
          recoveredPaymentData = recoveryData;
        }
      } catch (recoveryErr) {
        console.error('[A2U_RECOVERY] Failed to query existing payment', {
          order_id: order.id,
          a2u_payment_id: order.a2u_payment_id,
          error: recoveryErr.message,
        });
        return errorResponse(
          'Recovery check failed: ' + recoveryErr.message,
          500, 'recovery_check_failed', env
        );
      }
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

    // 优先级：a2u_txid → a2u_payment_id（恢复）→ 创建新 payment
    if (recoveredPaymentId) {
      // 复用已恢复的 payment（不创建新 payment，避免重复转账）
      console.log('[A2U] Reusing recovered payment:', recoveredPaymentId);
      a2uPaymentId = recoveredPaymentId;
      paymentData = recoveredPaymentData;
    } else {
      try {
        const a2uPayment = await piPlatformRequest(
          '/v2/payments',
          'POST',
          { payment: paymentArgs },
          env
        );
        a2uPaymentId = a2uPayment.identifier || a2uPayment.data?.identifier;
        console.log('[A2U] Payment created:', a2uPaymentId);

        // 立即持久化 a2u_payment_id，作为"转账进行中"标记
        // 防止后续步骤失败时重试导致重复创建 payment
        try {
          await supabaseRequest(
            `/orders?id=eq.${order.id}`,
            'PATCH',
            { a2u_payment_id: a2uPaymentId, updated_at: new Date().toISOString() },
            env
          );
          console.log('[A2U] a2u_payment_id persisted immediately:', a2uPaymentId);
        } catch (persistErr) {
          // 持久化失败：尝试取消刚创建的 payment，避免遗留
          console.error('[A2U] Failed to persist a2u_payment_id, cancelling payment', {
            order_id: order.id,
            a2uPaymentId,
            error: persistErr.message,
          });
          try {
            await piPlatformRequest(
              `/v2/payments/${a2uPaymentId}/cancel`,
              'POST', {}, env
            );
          } catch (cancelErr) {
            console.error('[A2U] Cancel after persist failure also failed', cancelErr.message);
          }
          return errorResponse(
            'Failed to persist payment id: ' + persistErr.message,
            500, 'persist_payment_id_failed', env
          );
        }

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

          // 重试创建后同样立即持久化 a2u_payment_id
          try {
            await supabaseRequest(
              `/orders?id=eq.${order.id}`,
              'PATCH',
              { a2u_payment_id: a2uPaymentId, updated_at: new Date().toISOString() },
              env
            );
            console.log('[A2U] a2u_payment_id persisted after retry:', a2uPaymentId);
          } catch (persistErr) {
            console.error('[A2U] Failed to persist a2u_payment_id after retry', persistErr.message);
            // 不阻断流程，恢复逻辑会在下次重试时处理
          }

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
    } // end of else (非 recoveredPaymentId 分支)

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
        case '/api/favorite':
          return await handleFavorite(request, env);
        case '/api/unfavorite':
          return await handleUnfavorite(request, env);
        case '/api/favorites':
          return await handleFavorites(request, env);
        case '/api/favorite-check':
          return await handleFavoriteCheck(request, env);
        case '/api/report':
          return await handleReport(request, env);
        case '/api/transfer-to-seller':
          return await handleTransferToSeller(request, env);
        // 管理员 API（handler 内 requireAdmin 校验 ADMIN_UIDS）
        case '/api/admin/reports':
          return await handleAdminReports(request, env);
        case '/api/admin/reports/review':
          return await handleAdminReportReview(request, env);
        case '/api/admin/items/block':
          return await handleAdminItemBlock(request, env);
        case '/api/admin/items/unblock':
          return await handleAdminItemUnblock(request, env);
        case '/api/admin/pending-transfers':
          return await handleAdminPendingTransfers(request, env);
        case '/api/admin/confirm-transfer':
          return await handleAdminConfirmTransfer(request, env);
        default:
          return errorResponse('Not found', 404, 'not_found', env);
      }
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse('Internal server error', 500, 'internal_error', env);
    }
  },
};

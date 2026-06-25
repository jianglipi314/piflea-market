/**
 * Piflea Backend - Cloudflare Workers
 * 对照官方 Pi Demo (https://github.com/pi-apps/demo) 修复支付流程
 *
 * 环境变量（在 Cloudflare Dashboard 设置）：
 * - PI_API_KEY: Pi Platform API Server Key (格式: Key xxxxxxxx)
 * - PLATFORM_API_URL: https://api.minepi.com (或测试网 URL)
 * - FRONTEND_URL: https://piflea.com
 * - SUPABASE_URL / SUPABASE_KEY: 数据库连接
 */

// ============ 常量 ============
const PLATFORM_API_URL = 'https://api.minepi.com';

// CORS 处理：根据环境变量动态设置允许的域名
function getCorsHeaders(env) {
  const allowedOrigin = env.FRONTEND_URL || '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    const { paymentId } = await request.json();
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
    const payment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);

    // 创建/更新订单
    const orderData = {
      payment_id: paymentId,
      product_id: payment.data?.metadata?.productId || payment.data?.metadata?.itemId || null,
      buyer_id: payment.data?.metadata?.buyerId || null,
      seller_id: payment.data?.metadata?.sellerId || null,
      amount: payment.data?.amount?.value || 0,
      memo: payment.data?.memo || '',
      status: 'approved',
      txid: null,
      cancelled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await updateOrder(paymentId, {
        status: 'approved',
        updated_at: new Date().toISOString(),
      }, env);
    } else {
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

    // 更新订单（统一用 'completed'）
    await updateOrder(paymentId, {
      status: 'completed',
      txid,
      updated_at: new Date().toISOString(),
    }, env);

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
    const url = new URL(request.url);
    const uid = url.searchParams.get('uid');
    const role = url.searchParams.get('role'); // 'buyer' | 'seller'

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

    const orders = await supabaseRequest(query, 'GET', null, env);

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
    const { order_id, seller_id } = await request.json();
    if (!order_id || !seller_id) {
      return errorResponse('order_id and seller_id required', 400, 'missing_params', env);
    }

    const orders = await supabaseRequest(
      `/orders?id=eq.${order_id}&seller_id=eq.${encodeURIComponent(seller_id)}&limit=1`,
      'GET', null, env
    );
    if (!orders || !orders.length) {
      return errorResponse('Order not found', 404, 'not_found', env);
    }

    await supabaseRequest(
      `/orders?id=eq.${order_id}`,
      'PATCH', { status: 'shipped', updated_at: new Date().toISOString() }, env
    );

    return jsonResponse({ success: true, message: 'Order marked as shipped' }, 200, env);
  } catch (err) {
    console.error('mark-shipped error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// 8. POST /api/create-order - 前端创建订单（已有，可保留兼容）
async function handleCreateOrder(request, env) {
  try {
    const body = await request.json();
    const { payment_id, txid, buyer_id, seller_id, item_id, item_title, item_price, amount, memo } = body;

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
      switch (path) {
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
        default:
          return errorResponse('Not found', 404, 'not_found', env);
      }
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse('Internal server error', 500, 'internal_error', env);
    }
  },
};

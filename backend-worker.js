/**
 * Piflea Backend - Cloudflare Workers (Simplified)
 * No A2U/Stellar code - manual transfer workflow
 */

// ============ CONFIG ============
const CONFIG = {
  // PI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_KEY come from env
};

const PLATFORM_API_URL = 'https://api.minepi.com';

// ============ Utility Functions ============

function getCorsHeaders(env) {
  const allowedOrigin = env.FRONTEND_URL || '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(data, status = 200, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: getCorsHeaders(env),
  });
}

function errorResponse(message, status = 400, code = 'error', env) {
  return jsonResponse({ success: false, error: code, message }, status, env);
}

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
  if (method === 'GET' || (method === 'PATCH' && headers['Prefer'].includes('return=representation'))) {
    return res.json();
  }
  return null;
}

// ============ Order Utilities ============

function isCompleted(status) {
  return status === 'completed' || status === 'paid';
}

function isApproved(status) {
  return status === 'approved';
}

function isCancelled(status) {
  return status === 'cancelled';
}

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

async function updateOrderByPaymentId(paymentId, updates, env) {
  return supabaseRequest(
    `/orders?payment_id=eq.${encodeURIComponent(paymentId)}`,
    'PATCH', updates, env
  );
}

// ============ Handlers ============

// POST /api/approve
async function handleApprove(request, env) {
  try {
    const { paymentId } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

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

    const payment = await piPlatformRequest(`/v2/payments/${paymentId}`, 'GET', null, env);

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
      await updateOrderByPaymentId(paymentId, {
        status: 'approved',
        updated_at: new Date().toISOString(),
      }, env);
    } else {
      await createOrder(orderData, env);
    }

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

// POST /api/complete - sets status to paid_pending_transfer
async function handleComplete(request, env) {
  try {
    const { paymentId } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

    const existing = await getOrderByPaymentId(paymentId, env);
    if (existing) {
      if (isCompleted(existing.status)) {
        return jsonResponse({
          success: true,
          message: `Payment ${paymentId} already completed`,
          status: existing.status,
        }, 200, env);
      }
      if (isCancelled(existing.status)) {
        return errorResponse('Payment already cancelled', 400, 'already_cancelled', env);
      }
    } else {
      return errorResponse('Order not found', 400, 'order_not_found', env);
    }

    await updateOrderByPaymentId(paymentId, {
      status: 'paid_pending_transfer',
      updated_at: new Date().toISOString(),
    }, env);

    return jsonResponse({
      success: true,
      message: `Payment ${paymentId} marked as pending manual transfer`,
      status: 'pending_manual_transfer',
    }, 200, env);
  } catch (err) {
    console.error('complete error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// POST /api/cancelled_payment
async function handleCancelled(request, env) {
  try {
    const { paymentId } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

    const existing = await getOrderByPaymentId(paymentId, env);

    if (existing) {
      if (isCompleted(existing.status)) {
        return errorResponse('Cannot cancel completed payment', 400, 'already_completed', env);
      }
      await updateOrderByPaymentId(paymentId, {
        status: 'cancelled',
        cancelled: true,
        updated_at: new Date().toISOString(),
      }, env);
    } else {
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

// POST /api/incomplete - sets status to paid_pending_transfer
async function handleIncomplete(request, env) {
  try {
    const { paymentId } = await request.json();
    if (!paymentId) return errorResponse('paymentId required', 400, 'missing_payment_id', env);

    const existing = await getOrderByPaymentId(paymentId, env);

    if (existing && isCompleted(existing.status)) {
      return jsonResponse({
        success: true,
        message: `Payment ${paymentId} already completed`,
        status: 'completed',
      }, 200, env);
    }

    if (existing) {
      await updateOrderByPaymentId(paymentId, {
        status: 'paid_pending_transfer',
        updated_at: new Date().toISOString(),
      }, env);
    } else {
      await createOrder({
        payment_id: paymentId,
        status: 'paid_pending_transfer',
        cancelled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, env);
    }

    return jsonResponse({
      success: true,
      message: `Handled incomplete payment ${paymentId}`,
      status: 'paid_pending_transfer',
    }, 200, env);
  } catch (err) {
    console.error('incomplete error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// GET /api/my-orders
async function handleMyOrders(request, env) {
  try {
    const url = new URL(request.url);
    const uid = url.searchParams.get('uid');
    const role = url.searchParams.get('role');

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

// POST /api/complete-order - buyer confirms receipt
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

// POST /api/mark-shipped - seller marks shipped
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

// POST /api/create-order
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

// ============ Admin Handlers ============

// GET /api/admin/pending-transfers
async function handlePendingTransfers(request, env) {
  try {
    const orders = await supabaseRequest(
      '/orders?status=eq.paid_pending_transfer&order=created_at.desc&limit=100',
      'GET', null, env
    );

    return jsonResponse({
      success: true,
      data: orders || [],
    }, 200, env);
  } catch (err) {
    console.error('pending-transfers error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// PATCH /api/admin/confirm-transfer
async function handleConfirmTransfer(request, env) {
  try {
    const { order_id } = await request.json();
    if (!order_id) {
      return errorResponse('order_id required', 400, 'missing_params', env);
    }

    await supabaseRequest(
      `/orders?id=eq.${order_id}`,
      'PATCH', { status: 'completed', updated_at: new Date().toISOString() }, env
    );

    return jsonResponse({ success: true, message: 'Transfer confirmed, order completed' }, 200, env);
  } catch (err) {
    console.error('confirm-transfer error:', err);
    return errorResponse(err.message, 500, 'internal_error', env);
  }
}

// ============ Router ============

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(env) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'PATCH') {
      return errorResponse('Method not allowed', 405, 'method_not_allowed', env);
    }

    try {
      // Health check
      if (path === '/api/health') {
        return jsonResponse({ success: true, message: 'Piflea backend is running!', status: 'ok' }, 200, env);
      }

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
        case '/api/admin/pending-transfers':
          return await handlePendingTransfers(request, env);
        case '/api/admin/confirm-transfer':
          return await handleConfirmTransfer(request, env);
        default:
          return errorResponse('Not found', 404, 'not_found', env);
      }
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse('Internal server error', 500, 'internal_error', env);
    }
  },
};

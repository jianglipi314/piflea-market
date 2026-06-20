/* ============ Pi SDK Integration ============ */

import { toast } from './utils';

const PI_USER_KEY = 'pi_flea_pi_user_v1';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://piflea-backend.vercel.app';

let PiIsAvailable = false;
let piUser = null;
let initPromise = null; // Track Pi.init() completion

/**
 * Initialize Pi SDK and attempt to restore previous session.
 * Called once at app startup.
 */
export function initPiAndAuthenticate(callback) {
  const isPiBrowser = typeof window.Pi !== 'undefined';

  if (isPiBrowser) {
    const isSandbox = import.meta.env.VITE_PI_SANDBOX !== 'false';
    initPromise = window.Pi.init({
      version: import.meta.env.VITE_PI_SDK_VERSION || '2.0',
      sandbox: isSandbox
    });

    initPromise
      .then(() => {
        PiIsAvailable = true;
        const cached = localStorage.getItem(PI_USER_KEY);
        if (cached) {
          try {
            piUser = JSON.parse(cached);
            if (callback) callback(piUser);
          } catch (e) {}
        }
        if (callback) callback(null);
      })
      .catch((err) => {
        console.error('Pi init failed:', err);
        PiIsAvailable = false;
        if (callback) callback(null);
      });
  } else {
    PiIsAvailable = false;
    setTimeout(() => { if (callback) callback(null); }, 100);
  }

  return {
    isAvailable: () => PiIsAvailable,
    getUser: () => piUser,
    waitForInit: () => initPromise || Promise.resolve()
  };
}

/** Wait for Pi.init() to complete before proceeding */
function ensureInit() {
  if (initPromise) return initPromise;
  return Promise.resolve();
}

/**
 * Authenticate with Pi.
 */
export async function authenticateWithPi() {
  if (!window.Pi) {
    toast('Pi SDK 不可用');
    return null;
  }

  // 强制清除旧会话，确保弹授权框、重新获取 payments 权限
  try { if (window.Pi && typeof window.Pi.logout === 'function') window.Pi.logout(); } catch (e) {}
  localStorage.removeItem(PI_USER_KEY);
  piUser = null;

  // 确保 init 完成
  await ensureInit();
  try {
    const authResult = await window.Pi.authenticate(
      ['username', 'payments'],
      function onIncompletePaymentFound(payment) {
        console.log('Incomplete payment found:', payment);
      }
    );
    if (authResult && authResult.user) {
      piUser = {
        uid: authResult.user.uid,
        username: authResult.user.username,
        accessToken: authResult.accessToken,
      };
      localStorage.setItem(PI_USER_KEY, JSON.stringify(piUser));
      toast('✅ 登录成功：@' + piUser.username);
      return piUser;
    }
    toast('登录失败：无用户数据');
    return null;
  } catch (error) {
    console.error('Pi auth error:', error);
    toast('登录失败：' + (error?.message || JSON.stringify(error)));
    return null;
  }
}

/**
 * Logout from Pi.
 */
export function logoutPi() {
  piUser = null;
  localStorage.removeItem(PI_USER_KEY);
  if (window.Pi && window.Pi.logout) {
    try {
      window.Pi.logout();
    } catch (e) {
      /* ignore */
    }
  }
  toast('已退出 Pi 登录');
}

/**
 * Check if Pi is authenticated.
 */
export function isPiAuthenticated() {
  return !!piUser;
}

/**
 * Get current Pi user.
 */
export function getPiUser() {
  return piUser;
}

/**
 * Create a Pi payment.
 * @param {number} amount
 * @param {string} memo
 * @param {object} metadata
 * @returns {Promise}
 */
/**
 * Create a Pi payment.
 * createPayment 是同步方法，不返回 Promise，通过 callbacks 通知结果
 */
export function createPiPayment(amount, memo, metadata = {}, onComplete) {
  console.log('[Pi SDK] createPiPayment called with amount:', amount);
  
  if (!window.Pi) {
    console.error('[Pi SDK] Error: window.Pi is undefined');
    toast('Pi SDK 不可用');
    if (onComplete) onComplete(false, 'Pi SDK 不可用');
    return;
  }
  
  console.log('[Pi SDK] window.Pi exists:', !!window.Pi);
  
  if (typeof window.Pi.createPayment !== 'function') {
    console.error('[Pi SDK] Error: window.Pi.createPayment is not a function');
    toast('Pi SDK createPayment 不可用');
    if (onComplete) onComplete(false, 'Pi SDK createPayment 不可用');
    return;
  }
  
  console.log('[Pi SDK] window.Pi.createPayment is available');
  
  if (!piUser) {
    console.error('[Pi SDK] Error: piUser is null, user not logged in');
    toast('请先登录 Pi 账号');
    if (onComplete) onComplete(false, '请先登录 Pi 账号');
    return;
  }
  
  console.log('[Pi SDK] User is logged in:', piUser.username);

  const resetButton = () => {
    if (onComplete) onComplete(true);
  };

  ensureInit().then(() => {
    console.log('[Pi SDK] Pi.init() completed, creating payment...');
    
    const paymentData = {
      amount: String(amount),
      memo: memo || 'Piflea payment',
      metadata: { app: 'piflea-market', ...metadata },
      uid: piUser.uid,
    };
    
    console.log('[Pi SDK] Payment data:', JSON.stringify(paymentData));

    window.Pi.createPayment(paymentData, {
      onReadyForServerApproval: function (paymentId) {
        console.log('[Pi SDK] onReadyForServerApproval:', paymentId);
        toast('支付等待确认');
        fetch(BACKEND_URL + '/api/approve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId }),
        }).catch(e => console.error('approve err:', e));
      },
      onReadyForServerCompletion: function (paymentId, txid) {
        console.log('[Pi SDK] onReadyForServerCompletion:', paymentId, txid);
        toast('✅ 支付完成！');
        fetch(BACKEND_URL + '/api/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId, txid }),
        }).catch(e => console.error('complete err:', e));
        resetButton();
      },
      onCancel: function (paymentId) {
        console.log('[Pi SDK] onCancel:', paymentId);
        toast('支付已取消');
        resetButton();
      },
      onError: function (error, payment) {
        console.error('[Pi SDK] onError:', error, payment);
        toast('支付失败：' + (error?.message || '未知错误'));
        resetButton();
      },
    });
    
    console.log('[Pi SDK] createPayment called successfully');
  }).catch(e => {
    console.error('[Pi SDK] ensureInit error:', e);
    toast('Pi SDK 初始化失败：' + e.message);
    if (onComplete) onComplete(false, 'Pi SDK 初始化失败');
  });
}

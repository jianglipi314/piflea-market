/* ============ Pi SDK Integration ============ */

import { toast } from './utils';

const PI_USER_KEY = 'pi_flea_pi_user_v1';
const BACKEND_URL = 'https://piflea-backend.1281582261.workers.dev';

let PiIsAvailable = false;
let piUser = null;
let initCompleted = false; // Track if init has completed

function debug(msg, isError = false) {
  if (window.debugLog) window.debugLog(msg, isError);
  console.log(isError ? '[ERROR]' : '[Pi SDK]', msg);
}

/**
 * Initialize Pi SDK and attempt to restore previous session.
 * Called once at app startup.
 */
export function initPiAndAuthenticate(callback) {
  const isPiBrowser = typeof window.Pi !== 'undefined';
  debug('initPiAndAuthenticate called, isPiBrowser: ' + isPiBrowser);

  if (isPiBrowser) {
    const isSandbox = import.meta.env.VITE_PI_SANDBOX !== 'false';
    debug('Calling Pi.init(), sandbox: ' + isSandbox);
    
    try {
      // Pi.init() may not return a Promise in some versions
      const initResult = window.Pi.init({
        version: import.meta.env.VITE_PI_SDK_VERSION || '2.0',
        sandbox: isSandbox
      });
      
      debug('Pi.init() returned: ' + typeof initResult);
      
      // Handle both Promise and non-Promise return values
      const handleInitComplete = () => {
        debug('Pi.init() completed');
        PiIsAvailable = true;
        initCompleted = true;
        const cached = localStorage.getItem(PI_USER_KEY);
        if (cached) {
          try {
            piUser = JSON.parse(cached);
            debug('Restored cached user: ' + piUser?.username);
            if (callback) callback(piUser);
          } catch (e) {
            debug('Failed to parse cached user', true);
          }
        }
        if (callback) callback(null);
      };
      
      if (initResult && typeof initResult.then === 'function') {
        initResult.then(handleInitComplete).catch((err) => {
          debug('Pi.init() promise rejected: ' + err, true);
          PiIsAvailable = false;
          initCompleted = true;
          if (callback) callback(null);
        });
      } else {
        // Pi.init() doesn't return a Promise, assume it's synchronous
        handleInitComplete();
      }
    } catch (err) {
      debug('Pi.init() error: ' + err, true);
      PiIsAvailable = false;
      initCompleted = true;
      if (callback) callback(null);
    }
  } else {
    debug('Not in Pi Browser, skipping init');
    PiIsAvailable = false;
    initCompleted = true;
    setTimeout(() => { if (callback) callback(null); }, 100);
  }

  return {
    isAvailable: () => PiIsAvailable,
    getUser: () => piUser,
    waitForInit: () => Promise.resolve()
  };
}

/** Wait for Pi.init() to complete before proceeding */
function ensureInit() {
  debug('ensureInit called, initCompleted: ' + initCompleted);
  
  if (initCompleted) {
    debug('Init already completed');
    return Promise.resolve();
  }
  
  // Wait for init to complete with timeout
  return new Promise((resolve) => {
    let timeout; // 先声明变量
    
    const checkInterval = setInterval(() => {
      if (initCompleted) {
        clearInterval(checkInterval);
        if (timeout) clearTimeout(timeout);
        debug('Init completed (waited)');
        resolve();
      }
    }, 100);
    
    timeout = setTimeout(() => {
      clearInterval(checkInterval);
      debug('ensureInit timeout after 5s', true);
      resolve();
    }, 5000);
  });
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
      async function onIncompletePaymentFound(payment) {
        console.log('[Pi SDK] Incomplete payment found:', payment);
        // 通知后端处理未完成的支付
        try {
          await fetch(BACKEND_URL + '/api/incomplete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId: payment.identifier })
          });
        } catch (e) {
          console.error('[Pi SDK] Failed to notify backend about incomplete payment:', e);
        }
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
  debug('createPiPayment called, amount: ' + amount);
  
  if (!window.Pi) {
    debug('window.Pi is undefined', true);
    toast('Pi SDK 不可用');
    if (onComplete) onComplete(false, 'Pi SDK 不可用');
    return;
  }
  
  debug('window.Pi exists: true');
  
  if (typeof window.Pi.createPayment !== 'function') {
    debug('window.Pi.createPayment is not a function', true);
    toast('Pi SDK createPayment 不可用');
    if (onComplete) onComplete(false, 'Pi SDK createPayment 不可用');
    return;
  }
  
  debug('window.Pi.createPayment is available');
  
  if (!piUser) {
    debug('piUser is null, user not logged in', true);
    toast('请先登录 Pi 账号');
    if (onComplete) onComplete(false, '请先登录 Pi 账号');
    return;
  }
  
  debug('User logged in: ' + piUser.username);

  // Timeout to prevent hanging - if no callback fires within 30s, reset the button
  let timeoutId = setTimeout(() => {
    debug('Payment timeout - no callback fired within 30s', true);
    toast('支付超时，请重试');
    if (onComplete) onComplete(false, '支付超时');
  }, 30000);

  const resetButton = (paymentId, txid) => {
    clearTimeout(timeoutId);
    if (onComplete) onComplete(true, null, paymentId, txid);
  };

  const failButton = (msg) => {
    clearTimeout(timeoutId);
    if (onComplete) onComplete(false, msg);
  };

  ensureInit().then(() => {
    debug('Creating payment...');
    
    const paymentData = {
      amount: Number(amount),
      memo: memo || 'Piflea payment',
      metadata: { app: 'piflea-market', ...metadata },
      uid: 'payment-' + Date.now()
    };
    
    debug('Payment data: ' + JSON.stringify(paymentData));
    debug('Payment data types - amount: ' + typeof paymentData.amount + ', amount value: ' + paymentData.amount);

    // 验证 amount 是否为有效数字
    if (isNaN(paymentData.amount) || paymentData.amount <= 0) {
      debug('Invalid amount: ' + paymentData.amount, true);
      toast('支付金额无效');
      failButton('支付金额无效');
      return;
    }

    try {
      debug('About to call window.Pi.createPayment...');
      window.Pi.createPayment(paymentData, {
        onReadyForServerApproval: function (paymentId) {
          debug('onReadyForServerApproval called! paymentId: ' + paymentId);
          toast('支付等待确认');
          fetch(BACKEND_URL + '/api/approve', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId }),
          }).catch(e => debug('approve err: ' + e, true));
        },
        onReadyForServerCompletion: function (paymentId, txid) {
          debug('onReadyForServerCompletion: ' + paymentId + ', txid: ' + txid);
          toast('✅ 支付完成！');
          fetch(BACKEND_URL + '/api/complete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId, txid }),
          }).catch(e => debug('complete err: ' + e, true));
          resetButton(paymentId, txid);
        },
        onCancel: function (paymentId) {
          debug('onCancel: ' + paymentId);
          toast('支付已取消');
          resetButton(paymentId, null);
        },
        onError: function (error, payment) {
          debug('onError: ' + (error?.message || error), true);
          toast('支付失败：' + (error?.message || '未知错误'));
          failButton(error?.message || '支付失败');
        },
      });
      
      debug('createPayment called successfully');
    } catch (e) {
      debug('createPayment exception: ' + e.message, true);
      toast('支付异常：' + e.message);
      failButton(e.message);
    }
  }).catch(e => {
    debug('ensureInit error: ' + e.message, true);
    toast('Pi SDK 初始化失败：' + e.message);
    failButton('Pi SDK 初始化失败');
  });
}

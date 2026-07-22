/* ============ Pi SDK Integration ============ */

import { toast } from './utils';
import { apiFetch } from './api';

const PI_USER_KEY = 'pi_flea_pi_user_v1';
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://piflea-backend.1281582261.workers.dev';

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

            // 静默重新认证，确保获取 payments scope
            silentReAuth();
          } catch (e) {
            debug('Failed to parse cached user', true);
            if (callback) callback(null);
          }
        } else {
          if (callback) callback(null);
        }
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
    const checkInterval = setInterval(() => {
      if (initCompleted) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        debug('Init completed (waited)');
        resolve();
      }
    }, 100);
    
    const timeout = setTimeout(() => {
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
      ['username', 'payments', 'wallet_address'],
      function onIncompletePaymentFound(payment) {
        console.log('Incomplete payment found:', payment);
      }
    );
    if (authResult && authResult.user) {
      console.log('[DEBUG Pi Auth] authResult keys:', Object.keys(authResult).join(', '));
      console.log('[DEBUG Pi Auth] accessToken length:', authResult.accessToken ? authResult.accessToken.length : 'not found');
      console.log('[DEBUG Pi Auth] user keys:', Object.keys(authResult.user).join(', '));
      const cred = authResult.user.credentials;
      const credKeys = cred ? Object.keys(cred) : [];
      console.log('[DEBUG Pi Auth] credentials keys:', credKeys.join(', '));
      piUser = {
        uid: authResult.user.uid,
        username: authResult.user.username,
        accessToken: authResult.accessToken,
      };
      localStorage.setItem(PI_USER_KEY, JSON.stringify(piUser));
      toast('DEBUG: valid_until=' + (cred?.valid_until || 'none') + ' | now=' + Date.now());
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
 * Silent re-authentication to ensure payments scope.
 * Does not logout first - just calls authenticate with payments scope.
 * If user already has payments scope, no popup appears.
 * If user lacks payments scope, Pi SDK will show the auth dialog.
 */
function silentReAuth() {
  if (!window.Pi || typeof window.Pi.authenticate !== 'function') return;

  window.Pi.authenticate(
    ['username', 'payments', 'wallet_address'],
    function onIncompletePaymentFound(payment) {
      console.log('[silentReAuth] Incomplete payment found:', payment);
    }
  ).then(function(authResult) {
    if (authResult && authResult.user) {
      console.log('[silentReAuth] Success, got payments scope for:', authResult.user.username);
      piUser = {
        uid: authResult.user.uid,
        username: authResult.user.username,
        accessToken: authResult.accessToken,
      };
      localStorage.setItem(PI_USER_KEY, JSON.stringify(piUser));
    }
  }).catch(function(err) {
    // 用户拒绝或网络问题，不影响正常使用
    console.log('[silentReAuth] Failed (user may have declined):', err?.message || err);
  });
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

  return new Promise((resolve, reject) => {
    const callback = (success, msg, paymentId, txid) => {
      if (onComplete) onComplete(success, msg, paymentId, txid);
      if (success) resolve({ paymentId, txid });
      else reject(new Error(msg || '支付失败'));
    };

    if (!window.Pi) {
      debug('window.Pi is undefined', true);
      toast('Pi SDK 不可用');
      callback(false, 'Pi SDK 不可用');
      return;
    }

    if (typeof window.Pi.createPayment !== 'function') {
      debug('window.Pi.createPayment is not a function', true);
      toast('Pi SDK createPayment 不可用');
      callback(false, 'Pi SDK createPayment 不可用');
      return;
    }

    if (!piUser) {
      debug('piUser is null, user not logged in', true);
      toast('请先登录 Pi 账号');
      callback(false, '请先登录 Pi 账号');
      return;
    }

    debug('User logged in: ' + piUser.username);

    // Timeout to prevent hanging
    let timeoutId = setTimeout(() => {
      debug('Payment timeout - no callback fired within 30s', true);
      toast('支付超时，请重试');
      callback(false, '支付超时');
    }, 30000);

    const resetButton = (paymentId, txid) => {
      clearTimeout(timeoutId);
      callback(true, null, paymentId, txid);
    };

    const failButton = (msg) => {
      clearTimeout(timeoutId);
      callback(false, msg);
    };

    ensureInit().then(() => {
      debug('Creating payment...');

      const paymentData = {
        amount: String(amount),
        memo: memo || 'Piflea payment',
        metadata: { app: 'piflea-market', ...metadata },
        uid: piUser.uid,
      };

      try {
        window.Pi.createPayment(paymentData, {
          onReadyForServerApproval: function (paymentId) {
            console.log('[DEBUG] onReadyForServerApproval triggered! paymentId:', paymentId);
            debug('onReadyForServerApproval: ' + paymentId);
            toast('支付等待确认');
            apiFetch('/api/approve', {
              method: 'POST',
              body: JSON.stringify({
                paymentId,
                buyerId: metadata.buyerId,
                sellerId: metadata.sellerId,
                itemId: metadata.itemId,
                itemTitle: metadata.itemTitle,
                itemPrice: metadata.itemPrice,
                amount: metadata.amount,
              }),
            }).then(r => r.json()).catch(e => {
              console.error('[DEBUG] approve err:', e);
              debug('approve err: ' + e, true);
            });
          },
          onReadyForServerCompletion: function (paymentId, txid) {
            console.log('[DEBUG] onReadyForServerCompletion triggered! paymentId:', paymentId, 'txid:', txid);
            debug('onReadyForServerCompletion: ' + paymentId + ', txid: ' + txid);
            toast('✅ 支付完成！正在创建订单...');
            apiFetch('/api/complete', {
              method: 'POST',
              body: JSON.stringify({ paymentId, txid }),
            }).then(r => r.json()).catch(e => {
              console.error('[DEBUG] complete err:', e);
              debug('complete err: ' + e, true);
            });
            resetButton(paymentId, txid);
          },
          onCancel: function (paymentId) {
            debug('onCancel: ' + paymentId);
            toast('支付已取消');
            failButton('支付已取消');
          },
          onError: function (error, payment) {
            const msg = error?.message || error || '未知错误';
            debug('onError: ' + msg, true);

            // 检测是否缺少 payments scope
            const noPermission = msg.includes('payments') || msg.includes('permission') || msg.includes('scope') || msg.includes('unauthorized');
            if (noPermission) {
              toast('缺少支付权限，请退出账号后重新登录并勾选 payments 权限');
              failButton('缺少支付权限，请退出账号后重新登录');
            } else {
              toast('支付失败：' + msg);
              failButton(msg);
            }
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
  });
}

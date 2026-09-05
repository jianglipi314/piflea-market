﻿/* ============ PiFlea Market — Main Entry ============ */
// Imports
import './styles/variables.css';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';

import { createState } from './state';
import { getOwnerId, toast, getAllMyUserIds } from './utils';
import { getSupabase } from './supabase';
import { initPiAndAuthenticate, isPiAuthenticated, getPiUser } from './pi-sdk';
import { initNav, goto } from './router';
import { initSheet } from './components/sheet';

// View modules
import { loadItems, setCat, toggleReco, setSort } from './views/home';
import { doSearch, onSearch } from './views/search';
import { clearForm, doPublish, onFiles, removeImg, togglePreview, openEdit } from './views/publish';
import { openDetail, fakeBuy, openDetailChat } from './views/detail';
import { openOrder, confirmPayment } from './views/order';
import { loadChatList, openChatByKey, sendMsg, checkChatTable, startUnreadPolling } from './views/chats';
import {
  renderMine,
  switchMine,
  showMineOverview,
  toggleAdmin,
  piLogin,
  piPayTest,
  piLogout,
  updatePiButtonState,
  exportData,
  markSold,
  unsetSold,
  deleteItem,
  gotoOrderDetail,
  loadOrders,
  completeOrder,
  markShipped,
} from './views/mine';
import { renderAdmin, adminToggleReco, adminDelete } from './views/admin';
import { openSheet, closeSheet } from './components/sheet';

// ============ Create global state ============ //
export const state = createState();
state.ownerId = getOwnerId();

// ============ Init on DOM ready ============ //
document.addEventListener('DOMContentLoaded', () => {
  // Init sub-systems
  initNav();
  initSheet();

  // 聊天页软键盘适配：以 visualViewport 为锚点，镜像到 CSS 变量 --vvh / --vvt。
  // - --vvh = 可见视口高度：容器高度随之收缩，底部 chat-input 自动贴到键盘上方。
  // - --vvt = offsetTop：用 transform: translateY 补正 adjustPan 内核下 fixed 覆盖层的位移，
  //   避免直接改 inline top 与浏览器原生平移叠加导致的二次偏移。
  // focus/blur 用分阶段延迟采样覆盖软键盘弹出/收起的动画过程。
  const chatViewportEl = document.getElementById('view-chat');
  const chatInputEl = document.getElementById('chatInput');
  const chatSendBtnEl = document.getElementById('chat-send-btn');
  const msgAreaEl = document.getElementById('msgArea');
  const rootEl = document.documentElement;
  const syncChatViewport = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    rootEl.style.setProperty('--vvh', vv.height + 'px');
    rootEl.style.setProperty('--vvt', vv.offsetTop + 'px');
  };
  const resetChatViewport = () => {
    rootEl.style.removeProperty('--vvh');
    rootEl.style.removeProperty('--vvt');
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncChatViewport);
    window.visualViewport.addEventListener('scroll', syncChatViewport);
  }
  window.addEventListener('resize', syncChatViewport);
  window.addEventListener('orientationchange', syncChatViewport);
  if (chatInputEl) {
    // 触屏判定：仅真机（有软键盘）才启用「键盘高度估算」兜底，避免桌面预览误触发。
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let keyboardMode = 'auto'; // 'auto' | 'fallback'
    let focusBeforeVvh = null;
    const focusTimers = [];
    const clearFocusTimers = () => {
      while (focusTimers.length) clearTimeout(focusTimers.pop());
    };
    // 键盘收起检测轮询：Pi 内核按返回键收键盘不触发 blur/focusout、视口也不变，
    // 只能靠轮询「焦点是否移除」来推断键盘已收起。
    // 注意：不能在这里检测 vv/ih 是否恢复——fallback 模式恰恰用于「视口从不缩小」的
    // Pi 内核，视口前后不变，恢复检测会恒为 true，导致刚抬起的输入框被立即降回。
    let pollTimer = null;
    const stopPolling = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };
    const collapseChat = () => {
      keyboardMode = 'auto';
      stopPolling();
      resetChatViewport();
    };
    const applyKeyboardFallback = () => {
      // Pi 内核弹键盘时不改变视觉视口（adjustNothing/overlay），完全无法从 API 感知键盘高度，
      // 只能用估算键盘高度手动上移，让 chat-input 露在键盘上方。
      const h = window.innerHeight;
      const kb = Math.max(220, Math.round(h * 0.42));
      rootEl.style.setProperty('--vvh', (h - kb) + 'px');
      rootEl.style.setProperty('--vvt', '0px');
      // 进入 fallback 后启动轮询，焦点离开输入框即视为键盘已收起
      stopPolling();
      pollTimer = setInterval(() => {
        if (keyboardMode !== 'fallback') { stopPolling(); return; }
        if (document.activeElement !== chatInputEl) collapseChat();
      }, 200);
    };
    // Chromium VirtualKeyboard API（Pi 内核基于 Chromium）：geometrychange 是唯一可靠的
    // 「键盘弹出/收起」事件流，还带精确键盘高度（收起时 boundingRect.height = 0）。
    const vk = navigator.virtualKeyboard;
    if (vk) {
      try { vk.overlaysContent = true; } catch (vkErr) { /* 旧内核该属性只读，忽略 */ }
      vk.addEventListener('geometrychange', (e) => {
        const kbH = e.target && e.target.boundingRect ? e.target.boundingRect.height : 0;
        if (kbH > 0) {
          // 键盘弹出：用精确高度收缩容器（比 42% 估算更准）
          keyboardMode = 'vk';
          clearFocusTimers();
          stopPolling();
          rootEl.style.setProperty('--vvh', (window.innerHeight - Math.round(kbH)) + 'px');
          rootEl.style.setProperty('--vvt', '0px');
        } else {
          // 键盘收起：自动回位，无需用户触摸
          collapseChat();
        }
      });
    }
    // 仅在 auto 模式才同步真实视口，避免覆盖 vk 精确高度 / fallback 估算高度
    const guardedSync = () => {
      if (keyboardMode === 'auto') syncChatViewport();
    };
    chatInputEl.addEventListener('focus', () => {
      // 清掉上一次可能残留的定时器，避免 blur 后又被旧的 fallback 判定抬上去
      clearFocusTimers();
      stopPolling();
      focusBeforeVvh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      keyboardMode = 'auto';
      syncChatViewport();
      focusTimers.push(setTimeout(guardedSync, 60));
      focusTimers.push(setTimeout(guardedSync, 180));
      // 350ms 后：视觉视口仍没明显缩小，说明内核不报告键盘，走估算高度兜底
      focusTimers.push(setTimeout(() => {
        if (keyboardMode !== 'auto') return; // vk 已接管
        const nowVvh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const shrank = focusBeforeVvh !== null && (focusBeforeVvh - nowVvh) > 60;
        if (isTouch && !shrank) {
          keyboardMode = 'fallback';
          applyKeyboardFallback();
        } else {
          syncChatViewport();
        }
      }, 350));
      // 最终采样：仅 auto 模式才同步真实视口，避免覆盖兜底/vk 高度
      focusTimers.push(setTimeout(() => {
        if (keyboardMode === 'auto') syncChatViewport();
      }, 600));
    });
    // blur 收不到时用 focusout 兜底（覆盖更多内核的收键盘场景）
    const onFocusOut = (e) => {
      // 焦点移向发送按钮时不回位：点发送后键盘应保持弹出（sendMsg 会拉回焦点）
      const rt = e && e.relatedTarget;
      if (rt && chatSendBtnEl && chatSendBtnEl.contains(rt)) return;
      // 键盘已收起：先清掉 focus 残留定时器，再清除变量，恢复 CSS 默认全屏高度，避免输入框悬空
      clearFocusTimers();
      stopPolling();
      collapseChat();
      setTimeout(collapseChat, 300);
    };
    chatInputEl.addEventListener('blur', onFocusOut);
    chatInputEl.addEventListener('focusout', onFocusOut);
    // Pi 内核下「收起键盘」不一定会触发 blur（如按返回键收键盘、或点页面空白），
    // 此时没有任何 web 视口事件可用；只要处于「抬升」状态（vk/fallback），用户触摸
    // 输入框以外区域就视为收起，主动回位。
    const collapseOnOutsideTouch = (e) => {
      if (keyboardMode === 'auto') return;
      if (e.target && chatInputEl.contains(e.target)) return;
      // 点发送按钮不视为「收起键盘」：发送后键盘保持弹出，继续输入
      if (e.target && chatSendBtnEl && chatSendBtnEl.contains(e.target)) return;
      collapseChat();
      // 顺带把焦点从输入框移走，避免键盘仍弹着时输入框继续保持聚焦
      if (document.activeElement === chatInputEl) chatInputEl.blur();
    };
    document.addEventListener('touchstart', collapseOnOutsideTouch, { capture: true, passive: true });
    document.addEventListener('mousedown', collapseOnOutsideTouch, { capture: true });
    // 收键盘后滑动/滚动页面也应回位（capture 可捕获 msg-area 内部滚动）。
    // 例外：输入框仍聚焦时消息区的滚动不回位——发送消息后 renderBubbles 会程序化
    // 滚动到底部，此时键盘还开着，不能把输入框降回去。
    document.addEventListener('scroll', (e) => {
      if (keyboardMode === 'auto') return;
      if (
        document.activeElement === chatInputEl &&
        e.target && e.target === msgAreaEl
      ) return;
      collapseChat();
    }, { capture: true, passive: true });
  }
  // 进入/离开聊天页（active 类切换，含从 chats.js 直接切换）时即时同步一次
  if (chatViewportEl && 'MutationObserver' in window) {
    new MutationObserver(syncChatViewport).observe(chatViewportEl, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
  syncChatViewport();

  // Topbar / page buttons (replace inline onclick with addEventListener for Pi Browser compat)
  // 顶部头像：点击进入"我的"页面
  const topAvatar = document.getElementById('topAvatar');
  if (topAvatar && !topAvatar._bound) {
    topAvatar._bound = true;
    topAvatar.addEventListener('click', () => goto('mine'));
  }

  const publishCta = document.getElementById('btn-publish-cta');
  if (publishCta) publishCta.addEventListener('click', () => goto('publish'));

  const searchClear = document.getElementById('btn-search-clear');
  if (searchClear) searchClear.addEventListener('click', () => {
    const qi = document.getElementById('qInput');
    if (qi) qi.value = '';
    onSearch();
  });

  const qInput = document.getElementById('qInput');
  if (qInput) qInput.addEventListener('input', () => onSearch());

  const oBackBtn = document.getElementById('o-back-btn');
  if (oBackBtn) oBackBtn.addEventListener('click', () => goto('detail'));

  const odBackBtn = document.getElementById('od-back-btn');
  if (odBackBtn) odBackBtn.addEventListener('click', () => goto('mine'));

  const checkChatBtn = document.getElementById('btn-check-chat');
  if (checkChatBtn) checkChatBtn.addEventListener('click', () => checkChatTable());

  const darkToggle = document.getElementById('darkToggle');
  if (darkToggle) darkToggle.addEventListener('click', () => toggleDark());

  const linkTerms = document.getElementById('link-terms');
  if (linkTerms) linkTerms.addEventListener('click', () => window.open('/terms.html', '_blank'));
  const linkPrivacy = document.getElementById('link-privacy');
  if (linkPrivacy) linkPrivacy.addEventListener('click', () => window.open('/privacy.html', '_blank'));
  const linkFeedback = document.getElementById('link-feedback');
  if (linkFeedback) linkFeedback.addEventListener('click', () => openSheet('feedback'));

  const adminBack = document.getElementById('admin-back');
  if (adminBack) adminBack.addEventListener('click', () => goto('mine'));

  const closeSheetBtn = document.getElementById('btn-close-sheet');
  if (closeSheetBtn) closeSheetBtn.addEventListener('click', () => closeSheet());

  // Init Pi SDK
  initPiAndAuthenticate((restoredUser) => {
    updatePiButtonState();
    if (restoredUser) {
      // 恢复登录后刷新与个人相关的数据
      import('./views/mine').then((mod) => {
        if (mod.applyPiUser) mod.applyPiUser();
        if (mod.loadOrders) {
          mod.loadOrders('buyer');
          mod.loadOrders('seller');
        }
      });
    } else {
      // Pi SDK 初始化完成但无缓存用户，立即请求 payments scope 登录
      import('./pi-sdk').then((mod) => {
        if (mod.isPiAvailable && mod.isPiAvailable() && !mod.isPiAuthenticated()) {
          mod.authenticateWithPi().then(() => updatePiButtonState());
        }
      });
    }
  });

  // 启动全局新消息轮询（内部自行判断登录状态，仅更新底部红点）
  startUnreadPolling();

  // Apply dark mode
  applyDarkOnLoad();

  // Start loading data
  loadItems();
});

// ============ Dark Mode ============ //
export function toggleDark() {
  state.dark = state.dark ? 0 : 1;
  applyDarkOnLoad();
  localStorage.setItem('pi_flea_dark_v3', state.dark);
}

function applyDarkOnLoad() {
  const isDark = !!state.dark;
  document.documentElement.setAttribute('data-dark', isDark ? '1' : '');
  document.documentElement.classList.toggle('dark', isDark);
  const tg = document.getElementById('darkToggle');
  if (tg) tg.classList.toggle('on', isDark);
}

// ============ Expose functions globally (for inline onclick) ============ //
// Home
window.toggleDark = toggleDark;
window.setCat = setCat;
window.toggleReco = toggleReco;
window.setSort = setSort;

// Search
window.doSearch = doSearch;
window.onSearch = onSearch;

// Publish
window.clearForm = clearForm;
window.doPublish = doPublish;
window.onFiles = onFiles;
window.removeImg = removeImg;
window.togglePreview = togglePreview;
window.openEdit = openEdit;

// Detail
window.openDetail = openDetail;
window.fakeBuy = fakeBuy;
window.openDetailChat = openDetailChat;
window.openOrder = openOrder;
window.confirmPayment = confirmPayment;

// Chats
window.openChatByKey = openChatByKey;
window.sendMsg = sendMsg;
window.checkChatTable = checkChatTable;

// Mine
window.switchMine = switchMine;
window.showMineOverview = showMineOverview;
window.toggleAdmin = toggleAdmin;
window.piLogin = piLogin;
window.piPayTest = piPayTest;
window.piLogout = piLogout;
window.exportData = exportData;
window.markSold = markSold;
window.unsetSold = unsetSold;
window.deleteItem = deleteItem;
window.isPiAuthenticated = isPiAuthenticated;
window.getPiUser = getPiUser;
window.loadOrders = loadOrders;
window.completeOrder = completeOrder;
window.markShipped = markShipped;
window.gotoOrderDetail = gotoOrderDetail;
// Prevent Vite tree-shaking
void loadOrders; void completeOrder; void markShipped; void gotoOrderDetail;

// Admin
window.adminToggleReco = adminToggleReco;
window.adminDelete = adminDelete;

// Sheet
window.openSheet = openSheet;
window.closeSheet = closeSheet;

// Navigation
window.goto = goto;
window.toast = toast;
window.getAllMyUserIds = getAllMyUserIds;



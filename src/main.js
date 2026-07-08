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
import { loadChatList, openChatByKey, sendMsg, checkChatTable } from './views/chats';
import {
  renderMine,
  switchMine,
  showMineOverview,
  editMyName,
  toggleAdmin,
  piLogin,
  piPayTest,
  piLogout,
  updatePiButtonState,
  exportData,
  markSold,
  unsetSold,
  gotoOrderDetail,
  loadOrders,
  completeOrder,
  markShipped,
} from './views/mine';
import { renderAdmin, adminToggleReco, adminDelete, adminLoadTransfers, adminCopyTransfer, adminConfirmTransfer } from './views/admin';
import { openSheet, closeSheet } from './components/sheet';

// ============ Create global state ============ //
export const state = createState();
state.ownerId = getOwnerId();

// ============ Init on DOM ready ============ //
document.addEventListener('DOMContentLoaded', () => {
  // Init sub-systems
  initNav();
  initSheet();

  // Topbar / page buttons (replace inline onclick with addEventListener for Pi Browser compat)
  const menuBtnEl = document.getElementById('btn-menu');
  if (menuBtnEl) menuBtnEl.addEventListener('click', () => openSheet('menu'));

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

  const cellPost = document.getElementById('cell-post');
  if (cellPost) cellPost.addEventListener('click', () => switchMine('post'));
  const cellBuy = document.getElementById('cell-buy');
  if (cellBuy) cellBuy.addEventListener('click', () => switchMine('buy'));
  const cellSell = document.getElementById('cell-sell');
  if (cellSell) cellSell.addEventListener('click', () => switchMine('sell'));
  const cellHist = document.getElementById('cell-hist');
  if (cellHist) cellHist.addEventListener('click', () => switchMine('hist'));

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

  const adminRefreshTransfers = document.getElementById('admin-refresh-transfers');
  if (adminRefreshTransfers) adminRefreshTransfers.addEventListener('click', () => adminLoadTransfers());

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
          console.log('[main] Auto-triggering Pi authenticate with payments scope');
          mod.authenticateWithPi().then(() => updatePiButtonState());
        }
      });
    }
  });

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
  const btn = document.getElementById('darkBtn');
  if (btn) btn.textContent = isDark ? '☀' : '🌙';
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
window.editMyName = editMyName;
window.toggleAdmin = toggleAdmin;
window.piLogin = piLogin;
window.piPayTest = piPayTest;
window.piLogout = piLogout;
window.exportData = exportData;
window.markSold = markSold;
window.unsetSold = unsetSold;
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
window.adminLoadTransfers = adminLoadTransfers;
window.adminCopyTransfer = adminCopyTransfer;
window.adminConfirmTransfer = adminConfirmTransfer;

// Sheet
window.openSheet = openSheet;
window.closeSheet = closeSheet;

// Navigation
window.goto = goto;
window.toast = toast;
window.getAllMyUserIds = getAllMyUserIds;



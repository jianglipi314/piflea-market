/* ============ PiFlea Market — Main Entry ============ */
// Imports
import './styles/variables.css';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';

import { createState } from './state';
import { getOwnerId, toast, getAllMyUserIds } from './utils';
import { getSupabase } from './supabase';
import { initPiAndAuthenticate } from './pi-sdk';
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
  editMyName,
  toggleAdmin,
  piLogin,
  piPayTest,
  piLogout,
  updatePiButtonState,
  exportData,
  markSold,
  unsetSold,
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

  // Init Pi SDK
  initPiAndAuthenticate(() => {
    updatePiButtonState();
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
  const attr = state.dark ? '1' : '';
  document.documentElement.setAttribute('data-dark', attr);
  const btn = document.getElementById('darkBtn');
  if (btn) btn.textContent = state.dark ? '☀' : '🌙';
  const tg = document.getElementById('darkToggle');
  if (tg) tg.classList.toggle('on', !!state.dark);
}

// ============ Expose functions globally (for inline onclick) ============ //
// Home
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
window.editMyName = editMyName;
window.toggleAdmin = toggleAdmin;
window.piLogin = piLogin;
window.piPayTest = piPayTest;
window.piLogout = piLogout;
window.exportData = exportData;
window.markSold = markSold;
window.unsetSold = unsetSold;

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

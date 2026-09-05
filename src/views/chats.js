/* ============ Chats View (Message List) ============ */

import { state } from '../main';
import { apiFetch } from '../api';
import { escapeHtml, timeAgo, toast, getAllMyUserIds, getCurrentUserId, getPiUid } from '../utils';

const CHATS_VIEWED_KEY = 'pi_flea_chats_viewed_v1';
// 会话级已读时间戳（纯前端展示，不涉及数据库）
const CHAT_READS_KEY = 'pi_flea_chat_reads_v1';

/**
 * Bind chat view buttons via addEventListener (idempotent via flags).
 * Replaces inline onclick/onkeydown handlers for Pi Browser compatibility.
 */
export function initChatButtons() {
  const backBtn = document.getElementById('chat-back-btn');
  if (backBtn && !backBtn._bound) {
    backBtn._bound = true;
    backBtn.addEventListener('click', () => window.goto('chats'));
  }
  const blockBtn = document.getElementById('chat-block-btn');
  if (blockBtn && !blockBtn._bound) {
    blockBtn._bound = true;
    blockBtn.addEventListener('click', () => toast('举报功能即将上线'));
  }
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn && !sendBtn._bound) {
    sendBtn._bound = true;
    // 点发送按钮不夺走输入框焦点（preventDefault 阻止聚焦），键盘保持弹出，
    // 发送后可继续输入；click 仍正常触发，不影响发送。
    // pointerdown + mousedown 双拦截：部分 WebView 内核在 mousedown 阶段决定焦点。
    sendBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    sendBtn.addEventListener('mousedown', (e) => e.preventDefault());
    sendBtn.addEventListener('click', sendMsg);
  }
  const chatInput = document.getElementById('chatInput');
  if (chatInput && !chatInput._keyBound) {
    chatInput._keyBound = true;
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') sendMsg();
    });
  }
}

/**
 * Record that the user viewed the chats page.
 */
function markChatsViewed() {
  localStorage.setItem(CHATS_VIEWED_KEY, String(Date.now()));
}

/**
 * 读取会话级已读时间戳表 { conversationKey: timestamp }。
 */
function getChatReads() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_READS_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

/**
 * 标记某个会话已读（进入该聊天并成功加载消息后调用）。
 */
function markChatRead(key) {
  if (!key) return;
  try {
    const reads = getChatReads();
    reads[key] = Math.max(reads[key] || 0, Date.now());
    localStorage.setItem(CHAT_READS_KEY, JSON.stringify(reads));
  } catch (e) {}
}

/**
 * Update the unread badge on the nav.
 */
function updateUnreadBadge(unreadCount) {
  const badge = document.getElementById('unreadBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

let chatSub = null;
let messagesCache = [];
let currentChatKey = null;

/**
 * 按「商品 + 双方 UID」把消息分组为会话，并记录最新一条消息。
 * 注意：/api/chat/list 返回 created_at 倒序，数组末位是最旧消息，
 * 必须按时间比较取最新，否则未读判断和列表预览都会取错。
 */
function groupConversations(data) {
  const groups = {};
  (data || []).forEach((m) => {
    const k = m.item_id + '|' + [m.from_uid, m.to_uid].sort().join('|');
    if (!groups[k]) {
      groups[k] = { key: k, itemId: m.item_id, messages: [], last: 0, lastMsg: null };
    }
    groups[k].messages.push(m);
    const t = new Date(m.created_at).getTime();
    if (t > groups[k].last) {
      groups[k].last = t;
      groups[k].lastMsg = m;
    }
  });
  return Object.values(groups);
}

/**
 * 会话未读判定：最新一条来自对方，且晚于
 * max(上次进入消息中心时间, 该会话本地已读时间)。
 */
function isConvUnread(g, me) {
  const lastMsg = g.lastMsg;
  if (!lastMsg || lastMsg.from_uid === me) return false;
  const lastViewed = parseInt(localStorage.getItem(CHATS_VIEWED_KEY) || '0', 10);
  const readAt = Math.max(lastViewed, getChatReads()[g.key] || 0);
  return new Date(lastMsg.created_at).getTime() > readAt;
}

/* ============ 全局未读轮询（仅更新红点，不渲染聊天列表） ============ */
let unreadPollTimer = null;
let unreadPollFetching = false;
const UNREAD_POLL_MS = 20000;

async function refreshUnreadBadge() {
  // 仅登录用户请求；未登录直接隐藏红点
  const me = getPiUid();
  if (!me) {
    updateUnreadBadge(0);
    return;
  }
  if (document.hidden || unreadPollFetching) return;
  unreadPollFetching = true;
  try {
    const res = await apiFetch('/api/chat/list');
    if (!res.ok) return;
    const json = await res.json();
    const list = groupConversations(json.data || []);
    updateUnreadBadge(list.reduce((n, g) => n + (isConvUnread(g, me) ? 1 : 0), 0));
  } catch (e) {
    // 静默失败，等待下一轮
  } finally {
    unreadPollFetching = false;
  }
}

/**
 * 启动全局新消息轮询（全局唯一定时器，main.js 初始化时调用一次）。
 */
export function startUnreadPolling() {
  if (unreadPollTimer) return;
  refreshUnreadBadge();
  unreadPollTimer = setInterval(refreshUnreadBadge, UNREAD_POLL_MS);
}

/**
 * Load chat list from Worker API.
 * 服务端用 token UID 过滤，只返回当前用户参与的会话。
 */
export async function loadChatList(markViewed = false) {
  const list = document.getElementById('chatList');
  const empty = document.getElementById('chatEmpty');
  const count = document.getElementById('chatCount');
  // 未读判断使用真实 Pi UID（与 /api/chat/list 的 token 过滤一致）
  const me = getPiUid();

  if (!me) {
    empty.textContent = '请先登录 Pi 账号';
    empty.style.display = 'block';
    count.textContent = '';
    updateUnreadBadge(0);
    return;
  }

  try {
    const res = await apiFetch('/api/chat/list');
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error('HTTP ' + res.status + ' | ' + (errBody.message || errBody.error || 'unknown error'));
    }
    const json = await res.json();
    const list2 = groupConversations(json.data || []);
    empty.style.display = list2.length ? 'none' : 'block';
    empty.textContent = '还没有消息，点进商品页联系卖家试试～';
    count.textContent = list2.length ? '共 ' + list2.length + ' 个会话' : '';

    // 先计算未读并更新红点（此时 lastViewed 仍是上次进入消息中心的时间）
    updateUnreadBadge(list2.reduce((n, g) => n + (isConvUnread(g, me) ? 1 : 0), 0));

    list.innerHTML = list2
      .map((g) => {
        const last = g.lastMsg; // 最新一条消息（API 返回为倒序，不能取数组末位）
        const isMeSender = last && last.from_uid === me;
        const unread = isConvUnread(g, me);
        const item = state.items.find(
          (x) => x.id === Number(g.itemId) || x.id === g.itemId
        );
        const sellerName = isMeSender
          ? item ? item.seller : '卖家'
          : item ? item.seller || '卖家' : '买家';

        // 未读会话：标题加粗 + 红点，预览加重
        const nameStyle = unread ? ' style="font-weight:800"' : '';
        const unreadDot = unread
          ? ' <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff3b30;vertical-align:middle"></span>'
          : '';
        const lastStyle = unread ? ' style="font-weight:600;color:var(--ink)"' : '';

        return '<div class="chat-item" data-key="' + g.key + '">'
          + '<div class="avatar">' + escapeHtml((sellerName || '\u03c0').slice(0, 1)) + '</div>'
          + '<div class="t"><div class="name"' + nameStyle + '>' + escapeHtml(sellerName || '聊天') + unreadDot + '</div><div class="last"' + lastStyle + '>' + escapeHtml((last && last.text) || '') + '</div></div>'
          + '<div class="time">' + timeAgo(g.last) + '</div>'
          + '</div>';
      })
      .join('');

    // 事件委托（替换内联 onclick，兼容 Pi Browser）
    const chatListEl = list;
    if (chatListEl && !chatListEl.dataset.bound) {
      chatListEl.dataset.bound = '1';
      chatListEl.addEventListener('click', function(e) {
        const item = e.target.closest('[data-key]');
        if (item) openChatByKey(item.dataset.key);
      });
    }

    // 列表和红点都完成后才标记「已进入消息中心」，保证本次未读先正确显示
    if (markViewed) markChatsViewed();
  } catch (err) {
    console.error('loadChatList', err);
    empty.textContent = '云端消息加载失败';
    empty.style.display = 'block';
    count.textContent = '';
  }
}

/**
 * Open a chat by conversation key.
 */
export async function openChatByKey(key) {
  const [itemId, uid1, uid2] = key.split('|');
  const myIds = getAllMyUserIds();
  const me = myIds.includes(uid1) ? uid1 : uid2;
  const other = me === uid1 ? uid2 : uid1;
  currentChatKey = key;
  let item = state.items.find((x) => String(x.id) === itemId);
  if (!item) {
    item = {
      id: Number(itemId) || itemId,
      title: '闲置商品',
      seller: '卖家'
    };
  }
  await openChatReal(item, other);
}

/**
 * Open a chat by item (from detail page).
 */
export async function openChatByItem(item, otherUid, key) {
  currentChatKey = key;
  await openChatReal(item, otherUid);
}

async function openChatReal(item, otherUid) {
  if (!item) { toast('商品不存在'); return; }

  // 未登录 Pi 账号时禁止进入聊天（在切换视图和调用 loadMessages 之前拦截）
  if (!getPiUid()) {
    toast('请先登录 Pi 账号');
    return;
  }

  // Bind chat buttons (idempotent)
  initChatButtons();

  const me = getCurrentUserId();

  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-chat').classList.add('active');
  document.getElementById('topTitle').textContent = '聊天';
  document.getElementById('topSub').textContent =
    '关于「' + (item.title || '闲置') + '」';
  document.getElementById('chat-name').textContent = item.seller || '卖家';
  document.getElementById('chat-sub').textContent =
    '关于「' + (item.title || '闲置') + '」';
  document.getElementById('chat-avatar').textContent = (item.seller || '?').slice(0, 1);

  await loadMessages(item.id, me, otherUid);
  subscribeMessages(item.id, me, otherUid);
  // 进入聊天后立即刷新红点（该会话已在 loadMessages 成功后标记已读）
  refreshUnreadBadge();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * Load messages for a specific conversation from Worker API.
 * 服务端校验当前用户是会话参与者，防止读取他人私聊。
 */
async function loadMessages(itemId, me, other) {
  try {
    const res = await apiFetch('/api/chat/messages?itemId=' + encodeURIComponent(itemId) + '&otherUid=' + encodeURIComponent(other));
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error('HTTP ' + res.status + ' | ' + (errBody.message || errBody.error || 'unknown error'));
    }
    const json = await res.json();
    const data = json.data || [];

    const newCache = data.map((m) => ({
      from: m.from_uid === me ? 'me' : 'seller',
      text: m.text,
      t: new Date(m.created_at).getTime(),
    }));

    // 只在消息数量或最后一条内容变化时重新渲染
    if (newCache.length !== messagesCache.length ||
        (newCache.length > 0 && messagesCache.length > 0 &&
         newCache[newCache.length - 1].text !== messagesCache[messagesCache.length - 1].text)) {
      messagesCache = newCache;
      renderBubbles();
    } else if (messagesCache.some(m => m.pending)) {
      // 替换 pending 消息
      messagesCache = newCache;
      renderBubbles();
    }

    // 成功加载即视为已读该会话（仅本地时间戳，3 秒轮询会持续续期）
    if (currentChatKey) markChatRead(currentChatKey);
  } catch (err) {
    toast('消息加载失败：' + (err.message || '请检查网络'));
  }
}

function subscribeMessages(itemId, me, other) {
  // 清除旧轮询
  if (chatSub) {
    try { chatSub.unsubscribe(); } catch (e) {}
    chatSub = null;
  }
  if (window._chatPollTimer) {
    clearInterval(window._chatPollTimer);
    window._chatPollTimer = null;
  }

  // 用轮询替代 Realtime（每 3 秒检查新消息）
  window._chatPollTimer = setInterval(async () => {
    if (!document.getElementById('view-chat').classList.contains('active')) {
      clearInterval(window._chatPollTimer);
      window._chatPollTimer = null;
      return;
    }
    await loadMessages(itemId, me, other);
  }, 3000);

  // 返回一个兼容的对象
  chatSub = {
    unsubscribe() {
      if (window._chatPollTimer) {
        clearInterval(window._chatPollTimer);
        window._chatPollTimer = null;
      }
    },
  };
}

function renderBubbles() {
  const box = document.getElementById('msgArea');
  box.innerHTML = messagesCache
    .map(
      (m) =>
        '<div class="bubble' + (m.from === 'me' ? ' me' : '') + '">' + escapeHtml(m.text)
        + '<div class="meta">' + timeAgo(m.t) + '</div></div>'
    )
    .join('');
  box.scrollTop = box.scrollHeight;
}

/**
 * Send a chat message via Worker API.
 * from_uid 由服务端从 Pi token 获取，客户端不传。
 */
export async function sendMsg() {
  const inp = document.getElementById('chatInput');
  const text = inp.value.trim();
  if (!text) return;
  if (text.length > 500) {
    toast('消息不能超过 500 字');
    return;
  }
  if (!currentChatKey) return;

  const [itemId, uid1, uid2] = currentChatKey.split('|');
  const myIds = getAllMyUserIds();
  const me = myIds.includes(uid1) ? uid1 : uid2;
  const other = me === uid1 ? uid2 : uid1;

  // 派浏览器内核点按钮时可能原生夺走输入框焦点导致键盘收起：
  // 发送时输入框聚焦（或键盘处于抬升状态）→ 发送过程中/结束后把焦点拉回，键盘保持弹出。
  const chatView = document.getElementById('view-chat');
  const kbRaised = chatView && chatView.getBoundingClientRect().height < window.innerHeight - 100;
  const keepKb = document.activeElement === inp || kbRaised;
  const refocusInput = () => {
    if (keepKb) inp.focus();
  };

  inp.value = '';

  // Optimistic update with pending flag
  messagesCache.push({ from: 'me', text, t: Date.now(), pending: true });
  renderBubbles();
  refocusInput();

  try {
    const res = await apiFetch('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({
        itemId: Number(itemId) || itemId,
        toUid: other,
        text: text,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || 'HTTP ' + res.status);
    }
  } catch (err) {
    toast('发送失败：' + (err.message || '请检查网络'));
    // Remove the pending message on error
    messagesCache = messagesCache.filter(m => m.text !== text || !m.pending);
    renderBubbles();
  }
  refocusInput();
  loadChatList();
}

/**
 * Check if the chat API is available.
 */
export async function checkChatTable() {
  const me = getCurrentUserId();
  if (!me) {
    toast('请先登录 Pi 账号');
    return;
  }
  try {
    const res = await apiFetch('/api/chat/list');
    if (res.ok) {
      toast('聊天功能已就绪');
      loadChatList();
      return;
    }
    const errJson = await res.json().catch(() => ({}));
    toast('聊天表异常：' + (errJson.error || 'HTTP ' + res.status));
  } catch (e) {
    toast('检测失败：' + (e.message || ''));
  }
}

export { chatSub, messagesCache, currentChatKey };
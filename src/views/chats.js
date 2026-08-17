/* ============ Chats View (Message List) ============ */

import { state } from '../main';
import { apiFetch } from '../api';
import { escapeHtml, timeAgo, toast, getAllMyUserIds, getCurrentUserId } from '../utils';

const CHATS_VIEWED_KEY = 'pi_flea_chats_viewed_v1';

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
export function markChatsViewed() {
  localStorage.setItem(CHATS_VIEWED_KEY, String(Date.now()));
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
 * Load chat list from Worker API.
 * 服务端用 token UID 过滤，只返回当前用户参与的会话。
 */
export async function loadChatList() {
  const list = document.getElementById('chatList');
  const empty = document.getElementById('chatEmpty');
  const count = document.getElementById('chatCount');
  const me = getCurrentUserId();

  if (!me) {
    empty.textContent = '请先登录 Pi 账号';
    empty.style.display = 'block';
    count.textContent = '';
    return;
  }

  try {
    const res = await apiFetch('/api/chat/list');
    if (!res.ok) {
      throw new Error('HTTP ' + res.status);
    }
    const json = await res.json();
    const data = json.data || [];

    // Group by conversation key: itemId|sorted(from_uid, to_uid)
    const groups = {};
    data.forEach((m) => {
      const k = m.item_id + '|' + [m.from_uid, m.to_uid].sort().join('|');
      if (!groups[k]) {
        groups[k] = { key: k, itemId: m.item_id, messages: [], last: 0 };
      }
      groups[k].messages.push(m);
      const t = new Date(m.created_at).getTime();
      if (t > groups[k].last) groups[k].last = t;
    });

    const list2 = Object.values(groups);
    empty.style.display = list2.length ? 'none' : 'block';
    empty.textContent = '还没有消息，点进商品页联系卖家试试～';
    count.textContent = list2.length ? '共 ' + list2.length + ' 个会话' : '';

    // Count unread conversations
    let unreadCount = 0;
    const lastViewed = parseInt(localStorage.getItem(CHATS_VIEWED_KEY) || '0', 10);
    list2.forEach(g => {
      const lastMsg = g.messages[g.messages.length - 1];
      if (lastMsg && new Date(lastMsg.created_at).getTime() > lastViewed) {
        if (lastMsg.from_uid !== me) unreadCount++;
      }
    });
    updateUnreadBadge(unreadCount);

    list.innerHTML = list2
      .map((g) => {
        const last = g.messages[g.messages.length - 1];
        const isMeSender = last.from_uid === me;
        const item = state.items.find(
          (x) => x.id === Number(g.itemId) || x.id === g.itemId
        );
        const sellerName = isMeSender
          ? item ? item.seller : '卖家'
          : item ? item.seller || '卖家' : '买家';

        return '<div class="chat-item" data-key="' + g.key + '">'
          + '<div class="avatar">' + escapeHtml((sellerName || '\u03c0').slice(0, 1)) + '</div>'
          + '<div class="t"><div class="name">' + escapeHtml(sellerName || '聊天') + '</div><div class="last">' + escapeHtml(last.text || '') + '</div></div>'
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
  const item = state.items.find((x) => String(x.id) === itemId);
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
      throw new Error('HTTP ' + res.status);
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
  inp.value = '';

  // Optimistic update with pending flag
  messagesCache.push({ from: 'me', text, t: Date.now(), pending: true });
  renderBubbles();

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
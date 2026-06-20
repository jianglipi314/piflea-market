/* ============ Chats View (Message List) ============ */

import { state } from '../main';
import { getSupabase } from '../supabase';
import { escapeHtml, timeAgo, toast, getAllMyUserIds, getCurrentUserId } from '../utils';

const CHATS_VIEWED_KEY = 'pi_flea_chats_viewed_v1';

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
 * Load chat list from Supabase.
 */
export async function loadChatList() {
  const supabase = getSupabase();
  if (!supabase) return;

  const list = document.getElementById('chatList');
  const empty = document.getElementById('chatEmpty');
  const count = document.getElementById('chatCount');
  const myIds = getAllMyUserIds();
  const orExpr = myIds.map(id => 'from_uid.eq.' + id + ',to_uid.eq.' + id).join(',');
  const me = myIds[0] || '';

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .or(orExpr)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadChatList', error);
    empty.textContent = '云端消息加载失败';
    empty.style.display = 'block';
    count.textContent = '';
    return;
  }

  // Group by conversation key: itemId|sorted(from_uid, to_uid)
  const groups = {};
  (data || []).forEach((m) => {
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

      return '<div class="chat-item" onclick="window.openChatByKey(\'' + g.key + '\')">'
        + '<div class="avatar">' + escapeHtml((sellerName || '\u03c0').slice(0, 1)) + '</div>'
        + '<div class="t"><div class="name">' + escapeHtml(sellerName || '聊天') + '</div><div class="last">' + escapeHtml(last.text || '') + '</div></div>'
        + '<div class="time">' + timeAgo(g.last) + '</div>'
        + '</div>';
    })
    .join('');
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

async function loadMessages(itemId, me, other) {
  const supabase = getSupabase();
  if (!supabase) return;

  const myIds = getAllMyUserIds();
  const fromParts = myIds.map(id => 'and(from_uid.eq.' + id + ',to_uid.eq.' + other + ')');
  const toParts = myIds.map(id => 'and(from_uid.eq.' + other + ',to_uid.eq.' + id + ')');
  const orExpr = [...fromParts, ...toParts].join(',');

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .or(orExpr)
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });

  if (error) {
    toast('消息加载失败：' + error.message);
    return;
  }

  messagesCache = (data || []).map((m) => ({
    from: m.from_uid === me ? 'me' : 'seller',
    text: m.text,
    t: new Date(m.created_at).getTime(),
  }));
  renderBubbles();
}

function subscribeMessages(itemId, me, other) {
  if (chatSub) {
    try { chatSub.unsubscribe(); } catch (e) {}
    chatSub = null;
  }

  const supabase = getSupabase();
  if (!supabase || !supabase.channel) return;

  const myIds = getAllMyUserIds();

  try {
    chatSub = supabase
      .channel('msg_' + itemId + '_' + Date.now())
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;
          if (String(m.item_id) !== String(itemId)) return;
          if (!myIds.includes(m.from_uid) && !myIds.includes(m.to_uid)) return;

          // Check for pending message to replace (avoid duplicate)
          const pendingIdx = messagesCache.findIndex(
            (x) => x.pending && x.text === m.text && x.from === (m.from_uid === me ? 'me' : 'seller')
          );
          if (pendingIdx >= 0) {
            // Replace pending message with confirmed one
            messagesCache[pendingIdx] = {
              from: m.from_uid === me ? 'me' : 'seller',
              text: m.text,
              t: new Date(m.created_at).getTime(),
            };
          } else {
            // Check for exact duplicate (same text and timestamp)
            if (messagesCache.find((x) => x.text === m.text && x.t === new Date(m.created_at).getTime())) return;
            messagesCache.push({
              from: m.from_uid === me ? 'me' : 'seller',
              text: m.text,
              t: new Date(m.created_at).getTime(),
            });
          }
          renderBubbles();
          loadChatList();
        }
      )
      .subscribe();
  } catch (e) {
    console.warn('subscribe fail', e);
  }
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
 * Send a chat message.
 */
export async function sendMsg() {
  const inp = document.getElementById('chatInput');
  const text = inp.value.trim();
  if (!text) return;
  if (!currentChatKey) return;

  const [itemId, uid1, uid2] = currentChatKey.split('|');
  const myIds = getAllMyUserIds();
  const me = myIds.includes(uid1) ? uid1 : uid2;
  const other = me === uid1 ? uid2 : uid1;
  inp.value = '';

  // Optimistic update with pending flag
  messagesCache.push({ from: 'me', text, t: Date.now(), pending: true });
  renderBubbles();

  const supabase = getSupabase();
  const { error } = await supabase.from('chat_messages').insert({
    item_id: Number(itemId) || itemId,
    from_uid: getCurrentUserId(),
    to_uid: other,
    text: text,
  });

  if (error) {
    toast('发送失败：' + error.message);
    // Remove the pending message on error
    messagesCache = messagesCache.filter(m => m.text !== text || !m.pending);
    renderBubbles();
  }
  loadChatList();
}

/**
 * Check if the chat_messages table exists.
 */
export async function checkChatTable() {
  const supabase = getSupabase();
  if (!supabase) { toast('请先等待云端连接'); return; }
  try {
    const { error } = await supabase.from('chat_messages').select('id').limit(1);
    if (!error) { toast('聊天功能已就绪'); loadChatList(); return; }
    toast('聊天表异常：' + (error.message || ''));
  } catch (e) {
    toast('检测失败：' + (e.message || ''));
  }
}

export { chatSub, messagesCache, currentChatKey };

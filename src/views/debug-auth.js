/* ============ 临时诊断：认证状态检查 ============
 * 只读，不修改任何状态，不发送任何数据到服务器。
 * 访问方式：在 Pi Browser 中打开 piflea.com，点击底部"诊断"链接。
 */

import { apiFetch } from '../api';
import { getCurrentUserId } from '../utils';

function maskToken(token) {
  if (!token || typeof token !== 'string') return 'N/A';
  if (token.length <= 10) return token.slice(0, 2) + '***' + token.slice(-2);
  return token.slice(0, 5) + '***' + token.slice(-5);
}

function checkLocalStorage() {
  const raw = localStorage.getItem('pi_flea_pi_user_v1');
  if (!raw) {
    return { exists: false, data: null, hasAccessToken: false };
  }
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { return { exists: true, data: null, hasAccessToken: false, parseError: true }; }
  return {
    exists: true,
    data,
    hasAccessToken: !!(data && typeof data.accessToken === 'string' && data.accessToken.trim()),
    hasUid: !!(data && data.uid),
    hasUsername: !!(data && data.username),
    accessTokenType: data ? typeof data.accessToken : 'N/A',
    accessTokenLen: data && data.accessToken ? data.accessToken.length : 0,
    accessTokenMasked: data && data.accessToken ? maskToken(data.accessToken) : 'N/A',
  };
}

function checkMemoryPiUser() {
  let piUser = null;
  // 尝试通过 window.getPiUser 获取
  if (typeof window.getPiUser === 'function') {
    piUser = window.getPiUser();
  }
  if (!piUser) {
    return { available: false, piUser: null, hasAccessToken: false };
  }
  return {
    available: true,
    piUser,
    hasAccessToken: !!(piUser && typeof piUser.accessToken === 'string' && piUser.accessToken.trim()),
    hasUid: !!(piUser && piUser.uid),
    hasUsername: !!(piUser && piUser.username),
    accessTokenType: piUser ? typeof piUser.accessToken : 'N/A',
    accessTokenLen: piUser && piUser.accessToken ? piUser.accessToken.length : 0,
    accessTokenMasked: piUser && piUser.accessToken ? maskToken(piUser.accessToken) : 'N/A',
  };
}

function diagnosis(localResult, memoryResult) {
  const lsHas = localResult.hasAccessToken;
  const memHas = memoryResult.hasAccessToken;
  const memAvailable = memoryResult.available;

  if (lsHas && memHas) return 'D';
  if (lsHas && !memAvailable) return 'D'; // localStorage 有，内存无法读取，按有处理
  if (lsHas && !memHas) return 'C';
  if (!lsHas) return 'B';
  return 'B';
}

function diagnosisLabel(code) {
  switch (code) {
    case 'D': return 'D = 两边都有 accessToken（正常）';
    case 'C': return 'C = localStorage 有，但内存 piUser 没有';
    case 'B': return 'B = localStorage 没有 accessToken';
    case 'A': return 'A = localStorage 有 accessToken';
    default: return '未知';
  }
}

function diagnosisColor(code) {
  switch (code) {
    case 'D': return '#4caf50';
    case 'C': return '#ff9800';
    case 'B': return '#f44336';
    default: return '#999';
  }
}

/* ============ GET Authorization 测试 ============ */
const BACKEND_URL = 'https://piflea-backend.1281582261.workers.dev';

async function runAuthTest() {
  const resultEl = document.getElementById('auth-test-result');
  if (!resultEl) return;

  resultEl.innerHTML = '<span style="color:var(--ink-2)">⏳ 测试中...</span>';

  const piUser = typeof window.getPiUser === 'function' ? window.getPiUser() : null;
  if (!piUser || !piUser.accessToken) {
    resultEl.innerHTML = '<span style="color:#f44336">❌ 无法测试：accessToken 不可用</span>';
    return;
  }

  const token = piUser.accessToken;
  const tokenMasked = maskToken(token);

  try {
    const res = await fetch(
      BACKEND_URL + '/api/chat/messages?itemId=test&otherUid=test',
      {
        headers: { 'Authorization': 'Bearer ' + token }
        // 故意不设置 Content-Type
      }
    );

    const status = res.status;
    let body = '';
    let parsed = null;
    try {
      body = await res.text();
      try { parsed = JSON.parse(body); } catch (_) {}
    } catch (_) {}

    const statusColor = res.ok ? '#4caf50' : '#f44336';
    const errorMsg = parsed ? (parsed.error || parsed.message || '') : '';
    const debugInfo = parsed ? (parsed._debug || '') : '';

    resultEl.innerHTML = `
      <div style="padding:10px;border-radius:8px;background:${statusColor}15;border:1px solid ${statusColor}">
        <div><strong>HTTP ${status}</strong> <span style="color:${statusColor}">${res.ok ? '✅' : '❌'}</span></div>
        <div style="margin-top:4px">Token: ${tokenMasked} (${token.length}字符)</div>
        ${errorMsg ? `<div style="margin-top:4px;color:${statusColor}">${escapeHtml(errorMsg)}</div>` : ''}
        ${debugInfo ? `<div style="margin-top:4px;color:#ff9800;font-size:12px">DEBUG: ${escapeHtml(debugInfo)}</div>` : ''}
        ${!errorMsg && !debugInfo ? `<div style="margin-top:4px;color:var(--ink-2);font-size:12px">原始响应: ${escapeHtml(body.slice(0, 300))}${body.length > 300 ? '...' : ''}</div>` : ''}
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `
      <div style="padding:10px;border-radius:8px;background:#f4433615;border:1px solid #f44336">
        <div><strong>网络错误</strong></div>
        <div style="margin-top:4px;font-size:12px;color:#f44336">${escapeHtml(err.message || String(err))}</div>
        <div style="margin-top:4px">Token: ${tokenMasked} (${token.length}字符)</div>
      </div>
    `;
  }
}

/* ============ apiFetch Authorization 测试 ============ */
async function runApiFetchTest() {
  const resultEl = document.getElementById('api-fetch-test-result');
  if (!resultEl) return;

  resultEl.innerHTML = '<span style="color:var(--ink-2)">⏳ 测试中...</span>';

  const piUser = typeof window.getPiUser === 'function' ? window.getPiUser() : null;
  if (!piUser || !piUser.accessToken) {
    resultEl.innerHTML = '<span style="color:#f44336">❌ 无法测试：accessToken 不可用</span>';
    return;
  }

  const token = piUser.accessToken;
  const tokenMasked = maskToken(token);

  try {
    // 使用项目现有的 apiFetch()，它会自动设置 Content-Type: application/json + Authorization
    const res = await apiFetch('/api/chat/messages?itemId=test&otherUid=test');

    const status = res.status;
    let body = '';
    let parsed = null;
    try {
      body = await res.text();
      try { parsed = JSON.parse(body); } catch (_) {}
    } catch (_) {}

    const statusColor = res.ok ? '#4caf50' : '#f44336';
    const errorMsg = parsed ? (parsed.error || parsed.message || '') : '';
    const debugInfo = parsed ? (parsed._debug || '') : '';

    resultEl.innerHTML = `
      <div style="padding:10px;border-radius:8px;background:${statusColor}15;border:1px solid ${statusColor}">
        <div><strong>HTTP ${status}</strong> <span style="color:${statusColor}">${res.ok ? '✅' : '❌'}</span></div>
        <div style="margin-top:4px">Token: ${tokenMasked} (${token.length}字符)</div>
        ${errorMsg ? `<div style="margin-top:4px;color:${statusColor}">${escapeHtml(errorMsg)}</div>` : ''}
        ${debugInfo ? `<div style="margin-top:4px;color:#ff9800;font-size:12px">DEBUG: ${escapeHtml(debugInfo)}</div>` : ''}
        ${!errorMsg && !debugInfo ? `<div style="margin-top:4px;color:var(--ink-2);font-size:12px">原始响应: ${escapeHtml(body.slice(0, 300))}${body.length > 300 ? '...' : ''}</div>` : ''}
      </div>
    `;
  } catch (err) {
    resultEl.innerHTML = `
      <div style="padding:10px;border-radius:8px;background:#f4433615;border:1px solid #f44336">
        <div><strong>网络错误</strong></div>
        <div style="margin-top:4px;font-size:12px;color:#f44336">${escapeHtml(err.message || String(err))}</div>
        <div style="margin-top:4px">Token: ${tokenMasked} (${token.length}字符)</div>
      </div>
    `;
  }
}

/* ============ 真实聊天参数 Authorization 测试 ============ */

/**
 * 从 /api/chat/list 获取真实会话的 itemId 和 otherUid。
 * 返回 null 表示无法获取真实参数。
 */
async function findRealChatParams() {
  try {
    const res = await apiFetch('/api/chat/list');
    if (!res.ok) return null;
    const json = await res.json();
    const data = json.data || [];
    if (data.length === 0) return null;

    const me = getCurrentUserId();
    const firstMsg = data[0];
    const otherUid = firstMsg.from_uid === me ? firstMsg.to_uid : firstMsg.from_uid;
    if (!firstMsg.item_id || !otherUid) return null;

    return { itemId: firstMsg.item_id, otherUid };
  } catch (_) {
    return null;
  }
}

/**
 * 发起一次测试请求并返回结果对象。
 */
async function doTestRequest(fetchFn, url, token) {
  try {
    const res = await fetchFn(url);
    const status = res.status;
    let body = '';
    let parsed = null;
    try {
      body = await res.text();
      try { parsed = JSON.parse(body); } catch (_) {}
    } catch (_) {}
    return {
      ok: res.ok,
      status,
      body,
      parsed,
      error: parsed ? (parsed.error || parsed.message || '') : '',
      debug: parsed ? (parsed._debug || '') : '',
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err), networkError: true };
  }
}

function renderTestBlock(result, tokenMasked, tokenLen) {
  if (result.networkError) {
    return `
      <div style="padding:10px;border-radius:8px;background:#f4433615;border:1px solid #f44336;margin-bottom:8px">
        <div><strong>网络错误</strong></div>
        <div style="margin-top:4px;font-size:12px;color:#f44336">${escapeHtml(result.error)}</div>
        <div style="margin-top:4px">Token: ${tokenMasked} (${tokenLen}字符)</div>
      </div>`;
  }
  const statusColor = result.ok ? '#4caf50' : '#f44336';
  return `
    <div style="padding:10px;border-radius:8px;background:${statusColor}15;border:1px solid ${statusColor};margin-bottom:8px">
      <div><strong>HTTP ${result.status}</strong> <span style="color:${statusColor}">${result.ok ? '✅' : '❌'}</span></div>
      <div style="margin-top:4px">Token: ${tokenMasked} (${tokenLen}字符)</div>
      ${result.error ? `<div style="margin-top:4px;color:${statusColor}">${escapeHtml(result.error)}</div>` : ''}
      ${result.debug ? `<div style="margin-top:4px;color:#ff9800;font-size:12px">DEBUG: ${escapeHtml(result.debug)}</div>` : ''}
      ${!result.error && !result.debug ? `<div style="margin-top:4px;color:var(--ink-2);font-size:12px">原始响应: ${escapeHtml((result.body || '').slice(0, 300))}${(result.body || '').length > 300 ? '...' : ''}</div>` : ''}
    </div>`;
}

async function runRealParamTests() {
  const resultEl = document.getElementById('real-param-test-result');
  if (!resultEl) return;

  resultEl.innerHTML = '<span style="color:var(--ink-2)">⏳ 正在查找真实聊天参数...</span>';

  const piUser = typeof window.getPiUser === 'function' ? window.getPiUser() : null;
  if (!piUser || !piUser.accessToken) {
    resultEl.innerHTML = '<span style="color:#f44336">❌ 无法测试：accessToken 不可用</span>';
    return;
  }

  const params = await findRealChatParams();
  if (!params) {
    resultEl.innerHTML = `
      <div style="padding:10px;border-radius:8px;background:#ff980015;border:1px solid #ff9800">
        <div><strong>⚠ 没有找到真实聊天参数</strong></div>
        <div style="margin-top:4px;font-size:12px;color:var(--ink-2)">当前账号没有聊天记录，或 /api/chat/list 返回空数据。</div>
        <div style="margin-top:4px;font-size:12px;color:var(--ink-2)">请先在 Pi Browser 中发起一次真实聊天后再来测试。</div>
      </div>`;
    return;
  }

  const token = piUser.accessToken;
  const tokenMasked = maskToken(token);
  const tokenLen = token.length;
  const url = '/api/chat/messages?itemId=' + encodeURIComponent(params.itemId) + '&otherUid=' + encodeURIComponent(params.otherUid);

  resultEl.innerHTML = `
    <div style="margin-bottom:8px;font-size:12px;color:var(--ink-2)">
      <div>itemId: <code>${escapeHtml(String(params.itemId))}</code></div>
      <div>otherUid: <code>${escapeHtml(String(params.otherUid))}</code></div>
    </div>
    <div id="real-native-result" style="font-size:13px">⏳ 原生 fetch 测试中...</div>
    <div id="real-api-fetch-result" style="font-size:13px">⏳ apiFetch 测试中...</div>`;

  // 原生 fetch（仅 Authorization，无 Content-Type）
  const nativeResult = await doTestRequest(
    (u) => fetch(BACKEND_URL + u, { headers: { 'Authorization': 'Bearer ' + token } }),
    url,
    token
  );
  const nativeEl = document.getElementById('real-native-result');
  if (nativeEl) {
    nativeEl.innerHTML = '<div style="font-size:11px;color:var(--ink-2);margin-bottom:4px">原生 fetch（仅 Authorization，无 Content-Type）</div>'
      + renderTestBlock(nativeResult, tokenMasked, tokenLen);
  }

  // apiFetch（Content-Type: application/json + Authorization）
  const apiFetchResult = await doTestRequest(
    (u) => apiFetch(u),
    url,
    token
  );
  const apiFetchEl = document.getElementById('real-api-fetch-result');
  if (apiFetchEl) {
    apiFetchEl.innerHTML = '<div style="font-size:11px;color:var(--ink-2);margin-bottom:4px">apiFetch()（Content-Type: application/json + Authorization）</div>'
      + renderTestBlock(apiFetchResult, tokenMasked, tokenLen);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function renderDebugAuth() {
  const el = document.getElementById('debug-output');
  if (!el) return;

  const local = checkLocalStorage();
  const memory = checkMemoryPiUser();
  const diag = diagnosis(local, memory);

  const html = `
    <div style="padding:16px;font-family:monospace;font-size:13px;line-height:1.7;color:var(--ink);background:var(--card);border-radius:10px;max-width:600px;margin:0 auto">
      <h3 style="margin:0 0 12px;font-size:16px">诊断结果</h3>

      <div style="padding:10px;border-radius:8px;margin-bottom:12px;background:${diagnosisColor(diag)}22;border:2px solid ${diagnosisColor(diag)}">
        <strong style="font-size:15px;color:${diagnosisColor(diag)}">${diagnosisLabel(diag)}</strong>
      </div>

      <div style="margin-bottom:16px">
        <strong>📦 localStorage (pi_flea_pi_user_v1)</strong>
        <div style="padding-left:8px">
          <div>存在: ${local.exists ? '✅ 是' : '❌ 否'}</div>
          ${local.parseError ? '<div style="color:#f44336">⚠ JSON 解析失败</div>' : ''}
          ${local.exists && !local.parseError ? `
            <div>uid: ${local.hasUid ? (local.data?.uid || '') : '❌ 无'}</div>
            <div>username: ${local.hasUsername ? (local.data?.username || '') : '❌ 无'}</div>
            <div>accessToken 存在: ${local.hasAccessToken ? '✅ 是' : '❌ 否'}</div>
            <div>accessToken 类型: ${local.accessTokenType}</div>
            <div>accessToken 长度: ${local.accessTokenLen}</div>
            ${local.accessTokenMasked !== 'N/A' ? `<div>accessToken 掩码: ${local.accessTokenMasked}</div>` : ''}
          ` : ''}
        </div>
      </div>

      <div style="margin-bottom:16px">
        <strong>🧠 内存 piUser (window.getPiUser)</strong>
        <div style="padding-left:8px">
          <div>getPiUser 可用: ${memory.available ? '✅ 是' : '❌ 否（window.getPiUser 未挂载）'}</div>
          ${memory.available ? `
            <div>uid: ${memory.hasUid ? (memory.piUser?.uid || '') : '❌ 无'}</div>
            <div>username: ${memory.hasUsername ? (memory.piUser?.username || '') : '❌ 无'}</div>
            <div>accessToken 存在: ${memory.hasAccessToken ? '✅ 是' : '❌ 否'}</div>
            <div>accessToken 类型: ${memory.accessTokenType}</div>
            <div>accessToken 长度: ${memory.accessTokenLen}</div>
            ${memory.accessTokenMasked !== 'N/A' ? `<div>accessToken 掩码: ${memory.accessTokenMasked}</div>` : ''}
          ` : ''}
        </div>
      </div>

      <div style="margin-bottom:16px">
        <strong>🌐 环境信息</strong>
        <div style="padding-left:8px">
          <div>Pi Browser: ${typeof window.Pi !== 'undefined' ? '✅ 是' : '❌ 否（非 Pi Browser）'}</div>
          <div>isPiAuthenticated: ${typeof window.isPiAuthenticated === 'function' ? (window.isPiAuthenticated() ? '✅ 是' : '❌ 否') : 'N/A'}</div>
          <div>URL: ${window.location.href}</div>
        </div>
      </div>

      <div style="margin-bottom:16px;border-top:2px dashed var(--line);padding-top:12px">
        <strong style="font-size:14px">🧪 GET Authorization 测试</strong>
        <div style="font-size:11px;color:var(--ink-2);margin-bottom:8px">原生 fetch（仅 Authorization，无 Content-Type）→ GET /api/chat/messages</div>
        <div id="auth-test-result" style="font-size:13px">⏳ 测试中...</div>
      </div>

      <div style="margin-bottom:16px;border-top:2px dashed var(--line);padding-top:12px">
        <strong style="font-size:14px">🧪 apiFetch Authorization 测试</strong>
        <div style="font-size:11px;color:var(--ink-2);margin-bottom:8px">apiFetch()（Content-Type: application/json + Authorization）→ GET /api/chat/messages</div>
        <div id="api-fetch-test-result" style="font-size:13px">⏳ 测试中...</div>
      </div>

      <div style="margin-bottom:16px;border-top:2px dashed var(--line);padding-top:12px">
        <strong style="font-size:14px">🧪 真实聊天参数 Authorization 测试</strong>
        <div style="font-size:11px;color:var(--ink-2);margin-bottom:8px">使用真实 itemId + otherUid（从 /api/chat/list 获取）</div>
        <div id="real-param-test-result" style="font-size:13px">⏳ 测试中...</div>
      </div>

      <div style="font-size:11px;color:var(--ink-2);border-top:1px solid var(--line);padding-top:10px;margin-top:12px">
        ⚠ 此页面仅用于诊断，不修改任何数据，不发送任何信息到服务器。<br>
        accessToken 已脱敏处理，不会完整显示。<br>
        刷新页面后手动重新进入此诊断页。
      </div>
    </div>
  `;

  el.innerHTML = html;

  // 自动运行所有 Auth 测试
  setTimeout(runAuthTest, 100);
  setTimeout(runApiFetchTest, 200);
  setTimeout(runRealParamTests, 300);
}
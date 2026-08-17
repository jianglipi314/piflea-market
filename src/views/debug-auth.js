/* ============ 临时诊断：认证状态检查 ============
 * 只读，不修改任何状态，不发送任何数据到服务器。
 * 访问方式：在 Pi Browser 中打开 piflea.com，点击底部"诊断"链接。
 */

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

      <div style="font-size:11px;color:var(--ink-2);border-top:1px solid var(--line);padding-top:10px;margin-top:12px">
        ⚠ 此页面仅用于诊断，不修改任何数据，不发送任何信息到服务器。<br>
        accessToken 已脱敏处理，不会完整显示。<br>
        刷新页面后手动重新进入此诊断页。
      </div>
    </div>
  `;

  el.innerHTML = html;
}
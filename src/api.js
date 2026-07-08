import { getPiUser } from './pi-sdk';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://piflea-backend.1281582261.workers.dev';

export function getBackendUrl() {
  return BACKEND_URL;
}

/**
 * 带身份验证的 fetch 请求
 */
export async function apiFetch(path, options = {}) {
  const user = getPiUser();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (user && user.accessToken) {
    headers['Authorization'] = 'Bearer ' + user.accessToken;
  }
  const res = await fetch(BACKEND_URL + path, { ...options, headers });
  return res;
}

export { BACKEND_URL };

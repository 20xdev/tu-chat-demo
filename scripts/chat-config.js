export const CONFIG_URL = 'https://main--tu-chat-demo--20xdev.aem.page/config.json';

const FIELDS = [
  'authorizationEndpoint', 'tokenEndpoint', 'logoutEndpoint', 'clientId', 'redirectUri',
  'scope', 'agentEndpoint', 'responseType', 'codeChallengeMethod', 'protocol',
];
const ENDPOINTS = ['authorizationEndpoint', 'tokenEndpoint', 'logoutEndpoint', 'redirectUri', 'agentEndpoint'];

function httpsURL(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Chat configuration: ${field} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || value.includes('#')
    || /[\s\\]/.test(value)) {
    throw new Error(`Chat configuration: ${field} must be HTTPS without credentials or fragments.`);
  }
  return url;
}

export function parseChatConfig(sheet, frontendOrigin) {
  if (!sheet || !Array.isArray(sheet.data)) {
    throw new Error('Chat configuration: the sheet must contain a data array.');
  }
  const { total, offset, limit } = sheet;
  if ((total !== undefined && (!Number.isInteger(total) || total !== sheet.data.length))
    || (offset !== undefined && offset !== 0)
    || (limit !== undefined && (!Number.isInteger(limit) || limit < sheet.data.length))) {
    throw new Error('Chat configuration: the sheet is incomplete or paginated.');
  }
  const rows = new Map();
  sheet.data.forEach((row) => {
    if (!row || typeof row.key !== 'string' || !row.key.trim()
      || row.key !== row.key.trim() || typeof row.value !== 'string') {
      throw new Error('Chat configuration: every row needs a non-empty key and string value.');
    }
    if (['__proto__', 'prototype', 'constructor'].includes(row.key) || rows.has(row.key)) {
      throw new Error('Chat configuration: duplicate or unsafe setting names are not permitted.');
    }
    rows.set(row.key, row.value);
  });
  const config = Object.fromEntries(FIELDS.map((field) => {
    const value = rows.get(field);
    if (!value?.trim() || value !== value.trim()) {
      throw new Error(`Chat configuration: ${field} is missing, empty or padded with whitespace.`);
    }
    return [field, value];
  }));
  ENDPOINTS.forEach((field) => httpsURL(config[field], field));
  if (/\s/.test(config.clientId)) throw new Error('Chat configuration: clientId contains whitespace.');
  if (new URL(config.redirectUri).origin !== frontendOrigin) {
    throw new Error('Chat configuration: the registered callback origin differs from this frontend. Open the configured frontend or correct the published sheet.');
  }
  if (config.responseType !== 'code' || config.codeChallengeMethod !== 'S256'
    || config.protocol !== 'ag-ui' || !config.scope.split(/\s+/).includes('openid')) {
    throw new Error('Chat configuration: code, S256, ag-ui and the openid scope are required.');
  }
  return Object.freeze(config);
}

export function createConfigLoader(
  fetcher = (...args) => fetch(...args),
  frontendOrigin = window.location.origin,
) {
  let loading;
  return function load() {
    if (!loading) {
      loading = (async () => {
        let response;
        try {
          response = await fetcher(CONFIG_URL, { credentials: 'omit', cache: 'no-store' });
        } catch {
          throw new Error('Chat configuration could not be downloaded. Check connectivity and sheet CORS.');
        }
        if (!response.ok) throw new Error(`Chat configuration request failed (HTTP ${response.status}).`);
        let sheet;
        try {
          sheet = await response.json();
        } catch {
          throw new Error('Chat configuration response is not valid JSON.');
        }
        return parseChatConfig(sheet, frontendOrigin);
      })().catch((error) => {
        loading = undefined;
        throw error;
      });
    }
    return loading;
  };
}

export const loadChatConfig = createConfigLoader();

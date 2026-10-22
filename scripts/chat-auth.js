import { loadChatConfig } from './chat-config.js';

export const TRANSACTION_KEY = 'tu-chat.pkce.v1';
const TRANSACTION_LIFETIME = 10 * 60 * 1000;

export function createChatAuth({
  configLoader = loadChatConfig,
  fetcher = (...args) => fetch(...args),
  storage = {
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: (key) => window.sessionStorage.removeItem(key),
  },
  location = window.location,
  history = window.history,
  navigate = (url) => location.assign(url),
  now = () => Date.now(),
  cryptoSource = crypto,
} = {}) {
  let config;
  let tokens;
  let initializing;
  let refreshing;
  let authorizing;
  let generation = 0;
  let snapshot = { status: 'loading', message: 'Loading chat configuration...' };
  const listeners = new Set();
  function publish(status, message) {
    snapshot = { status, message, config };
    listeners.forEach((listener) => listener(snapshot));
  }
  function clearTransaction() {
    try {
      storage.removeItem(TRANSACTION_KEY);
    } catch {
      throw new Error('Chat sign-in requires working session storage.');
    }
  }
  function signedOut(message) {
    generation += 1;
    tokens = undefined;
    publish('signed-out', message);
  }
  function validateTokens(value, previousRefresh) {
    if (!value || typeof value.access_token !== 'string' || !value.access_token.trim()
      || /\s/.test(value.access_token)
      || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer'
      || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in)
      || value.expires_in <= 0 || !Number.isFinite(now() + value.expires_in * 1000)
      || (value.refresh_token !== undefined
        && (typeof value.refresh_token !== 'string' || !value.refresh_token.trim()))) {
      throw new Error('The sign-in provider returned an invalid access-token response.');
    }
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token ?? previousRefresh,
      expiresAt: now() + value.expires_in * 1000,
    };
  }
  async function tokenRequest(parameters) {
    let response;
    try {
      response = await fetcher(config.tokenEndpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(parameters).toString(),
      });
    } catch {
      throw new Error('Could not contact the sign-in provider. Check connectivity and Cognito CORS.');
    }
    if (!response.ok) throw new Error(`The sign-in provider rejected the request (HTTP ${response.status}).`);
    try {
      return await response.json();
    } catch {
      throw new Error('The sign-in provider returned invalid JSON.');
    }
  }
  function cleanCallback(url) {
    ['code', 'state', 'error', 'error_description', 'error_uri', 'session_state']
      .forEach((key) => url.searchParams.delete(key));
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  async function callback() {
    const url = new URL(location.href);
    const callbackURL = new URL(config.redirectUri);
    if (url.origin !== callbackURL.origin || url.pathname !== callbackURL.pathname) return;
    if (!['code', 'state', 'error'].some((key) => url.searchParams.has(key))) return;
    const parameters = new URLSearchParams(url.search);
    let transaction;
    try {
      const stored = storage.getItem(TRANSACTION_KEY);
      transaction = stored ? JSON.parse(stored) : null;
    } catch {
      throw new Error('The pending chat sign-in transaction cannot be read.');
    } finally {
      clearTransaction();
      cleanCallback(url);
    }
    if (!transaction || typeof transaction.state !== 'string'
      || !/^[A-Za-z0-9_-]{43,128}$/.test(transaction.state)
      || parameters.getAll('state').length !== 1
      || parameters.get('state') !== transaction.state
      || typeof transaction.verifier !== 'string'
      || !/^[A-Za-z0-9_-]{43,128}$/.test(transaction.verifier)
      || transaction.redirectUri !== config.redirectUri || transaction.clientId !== config.clientId
      || typeof transaction.createdAt !== 'number' || !Number.isFinite(transaction.createdAt)
      || now() < transaction.createdAt || now() - transaction.createdAt >= TRANSACTION_LIFETIME) {
      throw new Error('Chat sign-in is missing, expired or has an invalid state. Start sign-in again.');
    }
    if (parameters.has('error')) {
      throw new Error('Chat sign-in was cancelled or rejected by the provider. Start sign-in again.');
    }
    const code = parameters.get('code');
    if (!code || parameters.getAll('code').length !== 1) {
      throw new Error('Chat sign-in callback has no valid authorization code.');
    }
    const currentGeneration = generation;
    const result = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: transaction.verifier,
    });
    const next = validateTokens(result);
    if (generation !== currentGeneration) throw new Error('Chat sign-in was cancelled.');
    tokens = next;
  }
  function initialize() {
    if (!initializing) {
      publish('loading', 'Loading chat configuration...');
      initializing = (async () => {
        config = await configLoader();
        await callback();
        publish(
          tokens ? 'authenticated' : 'signed-out',
          tokens ? 'Signed in to chat.' : 'Sign in securely to use chat.',
        );
        return config;
      })().catch((error) => {
        tokens = undefined;
        initializing = undefined;
        publish('error', error.message);
        throw error;
      });
    }
    return initializing;
  }
  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function beginLogin() {
    await initialize();
    if (new URL(config.redirectUri).origin !== location.origin) {
      throw new Error('Sign in from the registered frontend origin. The callback will not be substituted.');
    }
    const verifier = base64url(cryptoSource.getRandomValues(new Uint8Array(32)));
    const state = base64url(cryptoSource.getRandomValues(new Uint8Array(32)));
    const digest = await cryptoSource.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = base64url(new Uint8Array(digest));
    try {
      storage.setItem(TRANSACTION_KEY, JSON.stringify({
        verifier,
        state,
        redirectUri: config.redirectUri,
        clientId: config.clientId,
        createdAt: now(),
      }));
    } catch {
      throw new Error('Chat sign-in requires working session storage.');
    }
    const authorization = new URL(config.authorizationEndpoint);
    Object.entries({
      response_type: config.responseType,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: config.codeChallengeMethod,
    }).forEach(([key, value]) => authorization.searchParams.set(key, value));
    publish('signing-in', 'Opening secure sign-in...');
    navigate(authorization.href);
  }
  function login() {
    if (!authorizing) {
      authorizing = beginLogin().catch((error) => {
        publish('error', error instanceof Error ? error.message : 'Chat sign-in failed.');
        throw error;
      }).finally(() => { authorizing = undefined; });
    }
    return authorizing;
  }
  async function getAccessToken({ forceRefresh = false } = {}) {
    await initialize();
    if (!tokens) throw new Error('Sign in to chat before sending a message.');
    if (!forceRefresh && now() < tokens.expiresAt - 30000) return tokens.accessToken;
    if (!tokens.refreshToken) {
      signedOut('Your chat session has expired. Please sign in again.');
      throw new Error('Your chat session has expired. Please sign in again.');
    }
    if (!refreshing) {
      const currentGeneration = generation;
      const { refreshToken } = tokens;
      refreshing = (async () => {
        const result = await tokenRequest({
          grant_type: 'refresh_token', client_id: config.clientId, refresh_token: refreshToken,
        });
        const next = validateTokens(result, refreshToken);
        if (generation !== currentGeneration) throw new Error('Chat session changed during refresh.');
        tokens = next;
        publish('authenticated', 'Signed in to chat.');
        return next.accessToken;
      })().catch((error) => {
        if (generation === currentGeneration) {
          signedOut('Your chat session could not be refreshed. Please sign in again.');
        }
        throw error;
      }).finally(() => { refreshing = undefined; });
    }
    return refreshing;
  }
  return {
    initialize,
    login,
    getAccessToken,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    requireSignIn() {
      signedOut('Your chat authorization was rejected. Please sign in again.');
    },
    logout() {
      signedOut('Signed out of chat. Cognito single sign-on may still be active.');
      clearTransaction();
    },
  };
}

export const chatAuth = createChatAuth();

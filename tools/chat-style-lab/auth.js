import { parseChatConfig } from '../../scripts/chat-config.js';

// Local preview authentication is synthetic; it never contacts Cognito.
let current = { status: 'loading', message: 'Loading local mock configuration...' };
let loading;
const listeners = new Set();
function publish(status, message) {
  current = { ...current, status, message };
  listeners.forEach((listener) => listener(current));
}
export default {
  initialize() {
    if (!loading) {
      loading = (async () => {
        const response = await fetch('/__mock/config.json', { credentials: 'omit' });
        if (!response.ok) throw new Error('Local mock configuration failed.');
        const config = parseChatConfig(await response.json(), 'https://chat-style-lab.example.invalid');
        current.config = config;
        publish('signed-out', 'Local mock only: sign in starts a fictional session, not Cognito.');
        return config;
      })().catch((error) => {
        loading = undefined;
        publish('error', error.message);
        throw error;
      });
    }
    return loading;
  },
  subscribe(listener) {
    listeners.add(listener);
    listener(current);
    return () => listeners.delete(listener);
  },
  async login() {
    await this.initialize();
    publish('authenticated', 'Synthetic local session. No customer account is used.');
  },
  async getAccessToken() {
    if (current.status !== 'authenticated') throw new Error('Start a local mock session first.');
    return 'synthetic-local-access-token';
  },
  logout() {
    publish('signed-out', 'Local mock session ended.');
  },
  requireSignIn() {
    publish('signed-out', 'Local mock authorization rejected.');
  },
};

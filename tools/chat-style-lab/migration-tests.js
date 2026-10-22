import { CONFIG_URL, createConfigLoader, parseChatConfig } from '../../scripts/chat-config.js';
import { createChatAuth, TRANSACTION_KEY } from '../../scripts/chat-auth.js';
import {
  aguiAnswerParts, aguiNotice, applyAGUIEvent, createAGUIRequest, createAGUITurn, readAGUIStream,
} from '../../scripts/chat-agui.js';

const response = await fetch('/__mock/config.json');
if (!response.ok) throw new Error('Cannot load the synthetic migration fixture.');
const sheet = await response.json();
const origin = 'https://chat-style-lab.example.invalid';
const config = parseChatConfig(sheet, origin);
const routeFixture = {
  toolCallId: 'aws-route',
  ok: true,
  origin: { label: 'Flinders Street', position: [144.96512, -37.8182] },
  destination: { label: 'Melbourne Airport', position: [144.85017, -37.67137] },
  distance_km: 22.7,
  toll_total: 3.41,
  currency: 'AUD',
  segments: [
    { tolled: false, points: [[144.96512, -37.8182], [144.93921, -37.78603]] },
    { tolled: true, points: [[144.93921, -37.78603], [144.85017, -37.67137]] },
  ],
};
const cloneSheet = () => JSON.parse(JSON.stringify(sheet));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function rejects(action, fragment = '') {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  assert(failure instanceof Error && failure.message.includes(fragment), 'Expected explicit error');
}
function stream(events, byteSize = 7) {
  const text = typeof events === 'string' ? events
    : events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) controller.close();
      else {
        controller.enqueue(bytes.slice(offset, offset + byteSize));
        offset += byteSize;
      }
    },
  });
}
function authHarness({ lifetime = 120, refresh = true } = {}) {
  const entries = new Map([['unrelated', 'retained']]);
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
  const location = { href: `${origin}/`, origin };
  const history = {
    state: { unrelated: true },
    replaceState(state, title, path) { location.href = new URL(path, origin).href; },
  };
  let time = Date.now();
  let navigation;
  let rejectRefresh = false;
  const calls = [];
  const options = {
    configLoader: async () => config,
    storage,
    location,
    history,
    now: () => time,
    navigate: (url) => { navigation = url; },
    fetcher: async (url, request) => {
      calls.push({ url, request });
      const isRefresh = new URLSearchParams(request.body).get('grant_type') === 'refresh_token';
      if (isRefresh && rejectRefresh) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({
        access_token: isRefresh ? 'synthetic-refreshed-access' : 'synthetic-access',
        id_token: 'synthetic-id-not-for-aws',
        token_type: 'Bearer',
        expires_in: lifetime,
        ...(refresh ? { refresh_token: isRefresh ? 'synthetic-rotated-refresh' : 'synthetic-refresh' } : {}),
      }));
    },
  };
  const auth = createChatAuth(options);
  async function prepare() {
    await auth.login();
    return JSON.parse(storage.getItem(TRANSACTION_KEY));
  }
  async function complete() {
    const pending = await prepare();
    location.href = `${origin}/?keep=yes&code=synthetic-code&state=${pending.state}#anchor`;
    const returned = createChatAuth(options);
    await Promise.all([returned.initialize(), returned.initialize()]);
    return returned;
  }
  return {
    auth,
    options,
    calls,
    storage,
    location,
    history,
    prepare,
    complete,
    navigation: () => navigation,
    advance: (milliseconds) => { time += milliseconds; },
    failRefresh: () => { rejectRefresh = true; },
  };
}

const cases = [
  ['Sheet rows map in arbitrary order without rewriting callback or encoded ARN', () => {
    const input = cloneSheet();
    input.data.reverse();
    input.data.push({ key: 'unused-public-setting', value: 'not application state' });
    input.total += 1;
    input.limit += 1;
    const parsed = parseChatConfig(input, origin);
    assert(Object.keys(parsed).length === 10 && !parsed['unused-public-setting'], 'Unknown field merged');
    assert(
      parsed.agentEndpoint === config.agentEndpoint && parsed.redirectUri === config.redirectUri,
      'Configured URL bytes changed',
    );
    assert(Object.isFrozen(parsed), 'Configuration is mutable');
  }],
  ...Object.keys(config).map((key) => [`Sheet rejects missing/empty ${key}`, async () => {
    const input = cloneSheet();
    input.data.find((row) => row.key === key).value = '';
    await rejects(() => parseChatConfig(input, origin), key);
    input.data = input.data.filter((row) => row.key !== key);
    input.total -= 1;
    await rejects(() => parseChatConfig(input, origin), key);
  }]),
  ['Sheet rejects duplicate, malformed, dangerous and incomplete rows', async () => {
    const invalid = [
      { ...cloneSheet(), data: {} },
      { ...cloneSheet(), total: 11 },
      { ...cloneSheet(), offset: 1 },
      { ...cloneSheet(), limit: 9 },
      ...[null, { key: '', value: '' }, { key: 'key', value: 3 },
        { key: 'clientId', value: 'duplicate' },
        ...['__proto__', 'prototype', 'constructor'].map((key) => ({ key, value: '' }))]
        .map((row) => ({
          data: [...sheet.data, row], total: 11, limit: 11, offset: 0,
        })),
    ];
    await Promise.all(invalid.map((input) => rejects(() => parseChatConfig(input, origin))));
  }],
  ['Sheet rejects unsafe URLs, wrong callback origin and unsupported OAuth/protocol settings', async () => {
    const invalid = [
      ['agentEndpoint', 'http://frontdoor.example.invalid/'],
      ['tokenEndpoint', 'https://user:password@login.example.invalid/token'],
      ['logoutEndpoint', 'https://login.example.invalid/logout#fragment'],
      ['authorizationEndpoint', 'data:text/plain,invalid'],
      ['redirectUri', 'https://different.example.invalid/'],
      ['responseType', 'token'], ['codeChallengeMethod', 'plain'],
      ['protocol', 'a2a'], ['scope', 'email profile'],
    ];
    await Promise.all(invalid.map(([key, value]) => {
      const input = cloneSheet();
      input.data.find((row) => row.key === key).value = value;
      return rejects(() => parseChatConfig(input, origin));
    }));
  }],
  ['Sheet fetch uses a fixed root-relative URL, omits credentials and deduplicates loads', async () => {
    let calls = 0;
    const load = createConfigLoader(async (url, options) => {
      calls += 1;
      assert(
        url === '/config.json' && url === CONFIG_URL
          && options.credentials === 'omit' && !options.headers,
        'Sheet authentication or URL changed',
      );
      assert(
        new URL(url, `${origin}/account-and-passes/details`).href === `${origin}/config.json`,
        'Configuration inherited a page directory or a different origin',
      );
      return new Response(JSON.stringify(sheet));
    }, origin);
    const [a, b] = await Promise.all([load(), load()]);
    assert(a === b && await load() === a && calls === 1, 'Configuration requests duplicated');
  }],
  ['Sheet network, HTTP and JSON failures are explicit and retryable', async () => {
    await Promise.all([
      async () => { throw new TypeError('synthetic network failure'); },
      async () => new Response('{}', { status: 503 }),
      async () => new Response('not JSON'),
    ].map(async (fetcher) => {
      let attempts = 0;
      const load = createConfigLoader((...args) => {
        attempts += 1;
        return fetcher(...args);
      }, origin);
      await rejects(load);
      await rejects(load);
      assert(attempts === 2, 'Failed sheet promise was permanently cached');
    }));
  }],
  ['PKCE uses fresh independent state/verifier and a real S256 challenge', async () => {
    const harness = authHarness();
    const first = await harness.prepare();
    const url = new URL(harness.navigation());
    const challenge = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(first.verifier),
    ));
    const expected = btoa(String.fromCharCode(...challenge))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert(url.searchParams.get('code_challenge') === expected, 'PKCE challenge incorrect');
    assert(first.state !== first.verifier && first.state.length === 43, 'State/verifier not independent');
    assert(url.searchParams.get('redirect_uri') === config.redirectUri
      && url.searchParams.get('response_type') === 'code'
      && url.searchParams.get('scope') === config.scope, 'Authorization configuration lost');
    const second = await harness.prepare();
    assert(second.verifier !== first.verifier && second.state !== first.state, 'Login randomness reused');
  }],
  ['Root callback exchanges once, preserves navigation and keeps tokens out of storage', async () => {
    const harness = authHarness();
    const auth = await harness.complete();
    assert(
      harness.calls.length === 1 && await auth.getAccessToken() === 'synthetic-access',
      'Callback duplicated or ID token used',
    );
    const { request } = harness.calls[0];
    const form = new URLSearchParams(request.body);
    assert(form.get('redirect_uri') === config.redirectUri && form.get('code_verifier')
      && !form.has('client_secret') && request.credentials === 'omit', 'Invalid exchange');
    assert(!harness.storage.getItem(TRANSACTION_KEY)
      && harness.storage.getItem('unrelated') === 'retained', 'Wrong storage cleanup');
    assert(harness.location.href === `${origin}/?keep=yes#anchor`
      && harness.history.state.unrelated, 'Unrelated navigation state lost');
    const reloaded = createChatAuth(harness.options);
    await reloaded.initialize();
    await rejects(() => reloaded.getAccessToken(), 'Sign in');
  }],
  ...['missing', 'mismatch', 'expired', 'future', 'consumed', 'cancelled', 'no-code']
    .map((mode) => [`PKCE rejects ${mode} callbacks without a token exchange`, async () => {
      const harness = authHarness();
      const pending = await harness.prepare();
      if (['missing', 'consumed'].includes(mode)) harness.storage.removeItem(TRANSACTION_KEY);
      if (mode === 'expired') harness.advance(10 * 60 * 1000);
      if (mode === 'future') harness.advance(-1000);
      const parameters = new URLSearchParams({ state: mode === 'mismatch' ? 'wrong' : pending.state });
      if (mode === 'cancelled') parameters.set('error', 'access_denied');
      else if (mode !== 'no-code') parameters.set('code', 'synthetic-code');
      harness.location.href = `${origin}/?${parameters}`;
      await rejects(() => createChatAuth(harness.options).initialize());
      assert(harness.calls.length === 0 && !harness.storage.getItem(TRANSACTION_KEY), 'Invalid callback exchanged');
    }]),
  ['Refresh deduplicates, rotates tokens and uses standard public-client grant', async () => {
    const harness = authHarness();
    const auth = await harness.complete();
    harness.advance(100000);
    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    assert(tokens.every((token) => token === 'synthetic-refreshed-access')
      && harness.calls.length === 2, 'Refresh was not deduplicated');
    await auth.getAccessToken({ forceRefresh: true });
    const form = new URLSearchParams(harness.calls[2].request.body);
    assert(form.get('refresh_token') === 'synthetic-rotated-refresh'
      && !form.has('client_secret'), 'Refresh rotation lost');
  }],
  ['Invalid token responses and provider failures never establish authentication', async () => {
    const valid = { access_token: 'synthetic', token_type: 'Bearer', expires_in: 120 };
    const responses = [
      {}, { id_token: 'not-an-access-token', token_type: 'Bearer', expires_in: 120 },
      { ...valid, access_token: 'has whitespace' }, { ...valid, token_type: 'Basic' },
      { ...valid, expires_in: 0 }, { ...valid, expires_in: 1e308 },
      { ...valid, refresh_token: '' },
    ].map((value) => async () => new Response(JSON.stringify(value)));
    responses.push(
      async () => new Response('not JSON'),
      async () => new Response('{}', { status: 400 }),
      async () => { throw new TypeError('synthetic provider network failure'); },
    );
    await Promise.all(responses.map(async (fetcher) => {
      const harness = authHarness();
      const pending = await harness.prepare();
      harness.location.href = `${origin}/?code=synthetic&state=${pending.state}`;
      const auth = createChatAuth({ ...harness.options, fetcher });
      await rejects(() => auth.initialize());
      assert(!harness.storage.getItem(TRANSACTION_KEY), 'Failed token exchange retained transaction');
    }));
  }],
  ['Blocked session storage publishes a shared, retryable sign-in error', async () => {
    const harness = authHarness();
    let blocked = true;
    const auth = createChatAuth({
      ...harness.options,
      storage: {
        ...harness.storage,
        setItem(key, value) {
          if (blocked) throw new Error('synthetic storage denial');
          harness.storage.setItem(key, value);
        },
      },
    });
    let snapshot;
    auth.subscribe((state) => { snapshot = state; });
    await rejects(() => auth.login(), 'session storage');
    assert(
      snapshot.status === 'error' && snapshot.message.includes('session storage'),
      'Sign-in failure was not shared with header and launcher subscribers',
    );
    blocked = false;
    await auth.login();
    assert(
      snapshot.status === 'signing-in' && harness.navigation(),
      'A failed sign-in prevented a fresh login attempt',
    );
  }],
  ['Failed or unavailable refresh requires sign-in without reviving old tokens', async () => {
    await Promise.all([true, false].map(async (refresh) => {
      const harness = authHarness({ refresh });
      const auth = await harness.complete();
      harness.failRefresh();
      harness.advance(200000);
      await rejects(() => auth.getAccessToken());
      await rejects(() => auth.getAccessToken(), 'Sign in');
    }));
  }],
  ['Local logout clears owned auth only and discloses remaining provider SSO', async () => {
    const harness = authHarness();
    const auth = await harness.complete();
    let snapshot;
    auth.subscribe((next) => { snapshot = next; });
    auth.logout();
    assert(
      snapshot.status === 'signed-out' && snapshot.message.includes('single sign-on'),
      'Local logout misrepresented provider logout',
    );
    await rejects(() => auth.getAccessToken(), 'Sign in');
    assert(
      harness.calls.length === 1 && harness.storage.getItem('unrelated') === 'retained',
      'Logout called an unregistered destination or cleared unrelated storage',
    );
  }],
  ['AG-UI request contains latest turn, bearer access token and no A2A/cookie headers', () => {
    const thread = crypto.randomUUID();
    const session = crypto.randomUUID();
    const request = createAGUIRequest('Latest only', thread, session, 'synthetic-access');
    const body = JSON.parse(request.body);
    assert(
      Object.keys(body).sort().join() === 'context,forwardedProps,messages,runId,state,threadId,tools',
      'Incorrect AG-UI envelope',
    );
    assert(body.messages.length === 1 && body.messages[0].content === 'Latest only'
      && body.threadId === thread && request.credentials === 'omit', 'Request history/credentials wrong');
    assert(request.headers.Authorization === 'Bearer synthetic-access'
      && request.headers['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'] === session
      && !request.headers['X-Chat-Access-Token'], 'Wrong AWS authentication/session');
  }],
  ['AG-UI SSE handles byte-split UTF-8, CRLF, comments and multiline JSON', async () => {
    const state = createAGUITurn('thread');
    await readAGUIStream(
      stream(': comment\r\ndata: {"type":"TEXT_MESSAGE_CONTENT",\r\ndata: "messageId":"a","delta":"Hi \u{1F7E2}"}\r\n\r\ndata: [DONE]\r\n\r\n', 1),
      state,
      () => {},
    );
    assert(
      aguiAnswerParts(state)[0].text === 'Hi \u{1F7E2}' && state.outcome === 'completed',
      'SSE decoding/framing lost content',
    );
  }],
  ['AG-UI preserves whitespace, message identity, optional lifecycle and tool progress', async () => {
    const state = createAGUITurn('thread');
    applyAGUIEvent(state, { type: 'TEXT_MESSAGE_START', messageId: 'a' });
    applyAGUIEvent(state, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: ' A ' });
    applyAGUIEvent(state, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: ' B ' });
    applyAGUIEvent(state, {
      type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'ignored', runId: 'other',
    });
    applyAGUIEvent(state, { type: 'TOOL_CALL_START', toolCallId: 't', toolCallName: 'synthetic_tool' });
    assert(aguiNotice(state).includes('synthetic_tool'), 'Tool progress hidden');
    applyAGUIEvent(state, { type: 'TOOL_CALL_END', toolCallId: 't' });
    await readAGUIStream(stream([]), state, () => {});
    assert(aguiAnswerParts(state)[0].text === ' A  B ' && !aguiNotice(state), 'Text/progress changed');
  }],
  ['AG-UI rejects malformed events, JSON, empty streams and explicit RUN_ERROR', async () => {
    await Promise.all([
      '{}', 'data: not-json\n\n',
      [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 42 }],
      [{ type: 'RUN_ERROR', message: 'synthetic error 401 in text' }],
      [{ type: 'CUSTOM', value: {} }],
    ].map((events) => rejects(() => readAGUIStream(stream(events), createAGUITurn('t'), () => {}))));
    const state = createAGUITurn('t');
    await rejects(() => readAGUIStream(stream([
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Partial' },
      { type: 'RUN_ERROR', message: 'Explicit failure' },
    ]), state, () => {}), 'Explicit failure');
    assert(aguiAnswerParts(state)[0].text === 'Partial', 'Error discarded earlier text');
  }],
  ['Observed AWS routePlan and followUps render alongside text without unsupported notices', async () => {
    const state = createAGUITurn('thread');
    await readAGUIStream(stream([
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'preface', delta: "I'll price that drive for you." },
      { type: 'TOOL_CALL_START', toolCallId: 'aws-route', toolCallName: 'plan_toll_route' },
      { type: 'CUSTOM', name: 'routePlan', value: routeFixture },
      { type: 'TOOL_CALL_END', toolCallId: 'aws-route' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: 'Final  answer.\n\n' },
      { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'aws-followups', options: ['Check a different route', 'Plan another trip'] } },
      { type: 'RUN_FINISHED', threadId: state.threadId, runId: state.runId },
    ]), state, () => {});
    assert(
      state.tools.has('routePlan:aws-route') && state.tools.has('followUps:aws-followups'),
      'Observed custom results did not reach the renderer tool map',
    );
    assert(
      aguiAnswerParts(state)[0].text === "I'll price that drive for you.\n\nFinal  answer.\n\n",
      'Custom events changed text spacing or message order',
    );
    assert(state.outcome === 'completed' && !aguiNotice(state), 'Supported content showed a warning');
    assert(
      state.customEvents.length === 0 && state.customBytes === 0,
      'Known events incorrectly consumed unknown-event retention',
    );
  }],
  ['AG-UI known custom results upsert by name and tool-call identity', () => {
    const state = createAGUITurn('thread');
    const event = { type: 'CUSTOM', name: 'routePlan', value: routeFixture };
    applyAGUIEvent(state, event);
    const first = state.tools.get('routePlan:aws-route');
    applyAGUIEvent(state, JSON.parse(JSON.stringify(event)));
    assert(state.tools.get('routePlan:aws-route') === first, 'Repeated result recreated its view');
    applyAGUIEvent(state, { ...event, value: { ...routeFixture, toll_total: 4.2 } });
    assert(state.tools.get('routePlan:aws-route') !== first, 'Changed result did not update');
    applyAGUIEvent(state, { ...event, value: { ...routeFixture, toolCallId: 'another-route' } });
    applyAGUIEvent(state, { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'aws-route', options: ['Ask again'] } });
    assert(state.tools.size === 3, 'Independent calls or kinds overwrote each other');
    assert(createAGUITurn('other').tools.size === 0, 'Tool state leaked into another turn');
  }],
  ['AG-UI tool-only clean EOF retains recognized interactive content', async () => {
    const state = createAGUITurn('thread');
    await readAGUIStream(stream([
      { type: 'CUSTOM', name: 'routePlan', value: routeFixture },
    ]), state, () => {});
    assert(
      state.outcome === 'completed' && state.tools.size === 1 && !aguiNotice(state),
      'A valid tool-only reply was treated as an empty response',
    );
  }],
  ['AG-UI recognized custom events require explicit tool-call identity', async () => {
    await Promise.all(['routePlan', 'followUps'].flatMap((name) => [
      null, {}, { toolCallId: '' }, { toolCallId: 42 },
    ].map((value) => rejects(() => readAGUIStream(stream([{ type: 'CUSTOM', name, value }]), createAGUITurn('thread'), () => {}), 'tool call ID'))));
  }],
  ['AG-UI errors preserve mapped tools and text while clearing failed progress', async () => {
    const state = createAGUITurn('thread');
    await rejects(() => readAGUIStream(stream([
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'answer', delta: 'Partial answer' },
      { type: 'CUSTOM', name: 'routePlan', value: routeFixture },
      { type: 'TOOL_CALL_START', toolCallId: 'pending', toolCallName: 'plan_toll_route' },
      { type: 'RUN_ERROR', message: 'Synthetic route run failed' },
    ]), state, () => {}), 'Synthetic route run failed');
    assert(
      state.tools.size === 1 && aguiAnswerParts(state)[0].text === 'Partial answer',
      'Failure discarded usable route content',
    );
    assert(state.outcome === 'failed' && !aguiNotice(state), 'Failed tool progress stayed visible');
  }],
  ['Synthetic unknown CUSTOM retention is bounded, transient and never mapped to media', () => {
    const state = createAGUITurn('t');
    for (let index = 0; index < 100; index += 1) {
      applyAGUIEvent(state, { type: 'CUSTOM', name: 'synthetic-arbitrary', value: { html: '<img src=x>', index } });
    }
    assert(
      state.customEvents.length === 20 && state.customTruncated && state.tools.size === 0,
      'Custom storage unbounded or fabricated media',
    );
    assert(
      !aguiNotice(state).includes('<img') && aguiNotice(state).includes('limit'),
      'Payload dumped or truncation hidden',
    );
    const oversized = createAGUITurn('t');
    applyAGUIEvent(oversized, { type: 'CUSTOM', name: 'synthetic', value: 'x'.repeat(65536) });
    assert(oversized.customEvents.length === 0 && oversized.customTruncated, 'Custom bytes unbounded');
    assert(createAGUITurn('new').customEvents.length === 0, 'Custom events leaked across turns');
  }],
  ['AG-UI completion cancels/releases the reader without waiting for transport closure', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"RUN_FINISHED"}\n\n'));
      },
      cancel() { cancelled = true; },
    });
    await readAGUIStream(body, createAGUITurn('t'), () => {});
    assert(cancelled && !body.locked, 'Reader not cancelled/released');
  }],
  ['Optional AG-UI DONE sentinel completes even when the connection stays open', async () => {
    let cancelled = false;
    const state = createAGUITurn('t');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"a","delta":"Done"}\n\ndata: [DONE]\n\n',
        ));
      },
      cancel() { cancelled = true; },
    });
    await readAGUIStream(body, state, () => {});
    assert(
      cancelled && state.outcome === 'completed' && aguiAnswerParts(state)[0].text === 'Done',
      'Optional DONE sentinel stalled or lost the answer',
    );
  }],
];

export default cases;

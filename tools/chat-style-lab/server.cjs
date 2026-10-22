const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { eventFixtures, fixtures, routeImage } = require('./fixtures.cjs');
const { sheet } = require('./config-fixture.cjs');

const upstream = 'http://localhost:3000';
const port = Number(process.env.CHAT_STYLE_LAB_PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('CHAT_STYLE_LAB_PORT must be an integer between 1 and 65535.');
}
const localURL = `http://localhost:${port}`;
const retryAttempts = new Set();
let mockRequests = 0;

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function mockResponse(req, res, agui = false) {
  let body = '';
  // eslint-disable-next-line no-restricted-syntax -- Native Node async iteration.
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65536) {
      send(res, 413, 'text/plain', 'Mock request too large');
      return;
    }
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    send(res, 400, 'text/plain', 'Invalid mock JSON');
    return;
  }
  const text = agui ? data.messages?.[0]?.content
    : data.params?.message?.parts?.find((part) => part.kind === 'text')?.text;
  if (typeof text !== 'string') {
    send(res, 400, 'text/plain', 'Expected a text message');
    return;
  }
  mockRequests += 1;
  let scenario = text.match(/^\[demo:([a-z-]+)\]/)?.[1];
  if (!scenario) {
    scenario = 'journey';
    if (/pass/i.test(text)) scenario = 'compare';
    else if (/notice/i.test(text)) scenario = 'notice';
  }
  if (scenario !== 'custom' && !Object.hasOwn(fixtures, scenario)
    && !Object.hasOwn(eventFixtures, scenario)) {
    send(res, 400, 'text/plain', 'Unknown mock scenario');
    return;
  }
  const retryKey = `${agui ? data.threadId : data.params.message.contextId}:${scenario}`;
  if (scenario === 'error' && !retryAttempts.has(retryKey)) {
    retryAttempts.add(retryKey);
    send(res, 503, 'application/json', JSON.stringify({ error: 'Intentional local demo failure; retry succeeds.' }));
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Local-Mock': 'true',
  });
  res.flushHeaders();
  const fixture = fixtures[scenario];
  const responseParts = typeof fixture === 'string' ? [{ kind: 'text', text: fixture }] : (fixture || []);
  const parts = responseParts.flatMap((part) => (part.kind === 'text'
    ? (part.text.match(/[\s\S]{1,100}/g) || []).map((textChunk) => ({ kind: 'text', text: textChunk }))
    : [part]));
  let events = eventFixtures[scenario] || [
    ...parts.map((part, partIndex) => ({
      result: {
        kind: 'artifact-update',
        append: partIndex > 0,
        lastChunk: partIndex === parts.length - 1,
        artifact: { artifactId: 'local-demo', parts: [part] },
      },
    })),
    { result: { kind: 'status-update', status: { state: 'completed' }, final: true } },
  ];
  if (agui && scenario === 'agui-route') {
    events = eventFixtures[scenario].map((event) => (event.type === 'RUN_FINISHED'
      ? { ...event, threadId: data.threadId, runId: data.runId } : event));
  } else if (agui) {
    // Synthetic AG-UI fixtures never call the production agent.
    const chunks = parts.filter((part) => part.kind === 'text');
    events = [
      { type: 'RUN_STARTED', threadId: data.threadId, runId: data.runId },
      ...chunks.map((part) => ({
        type: 'TEXT_MESSAGE_CONTENT', messageId: 'synthetic-answer', delta: part.text,
      })),
    ];
    if (scenario === 'custom') {
      events.push(
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'synthetic-answer', delta: 'Synthetic custom-event test. No map or media contract is implied.' },
        { type: 'CUSTOM', name: 'synthetic-unmapped-event', value: { fixture: true } },
      );
    }
    if (['interrupted', 'rpc-error'].includes(scenario)) {
      events.push(
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'synthetic-answer', delta: 'Partial synthetic answer.' },
        { type: 'RUN_ERROR', message: 'Synthetic agent failure after partial output.' },
      );
    } else events.push({ type: 'RUN_FINISHED', threadId: data.threadId, runId: data.runId });
  }
  let index = 0;
  let timer;
  function next() {
    if (res.destroyed) return;
    if (index >= events.length) {
      res.end();
      return;
    }
    const event = events[index];
    const envelope = agui ? event : { jsonrpc: '2.0', id: data.id, ...event };
    if (event.result) {
      const taskId = `local-${data.params.message.messageId}`;
      envelope.result = {
        ...event.result,
        contextId: data.params.message.contextId,
        ...(event.result.kind === 'task' ? { id: taskId } : { taskId }),
      };
    }
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
    index += 1;
    timer = setTimeout(next, 90);
  }
  timer = setTimeout(next, scenario === 'slow' ? 4500 : 450);
  res.on('close', () => clearTimeout(timer));
}

const files = {
  '/__mock/preview.html': ['preview.html', 'text/html; charset=utf-8'],
  '/__mock/preview.js': ['preview.js', 'text/javascript; charset=utf-8'],
  '/__mock/experimental.css': ['experimental.css', 'text/css; charset=utf-8'],
  '/__mock/renderer-tests.html': ['renderer-tests.html', 'text/html; charset=utf-8'],
  '/__mock/renderer-tests.js': ['renderer-tests.js', 'text/javascript; charset=utf-8'],
  '/__mock/migration-tests.js': ['migration-tests.js', 'text/javascript; charset=utf-8'],
  '/__mock/auth.js': ['auth.js', 'text/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, localURL);
    if (url.pathname === '/__mock/health') {
      send(res, 200, 'application/json', JSON.stringify({ localOnly: true, upstream, mockRequests }));
      return;
    }
    if (url.pathname === '/__mock/a2a' && req.method === 'POST') {
      await mockResponse(req, res);
      return;
    }
    if (url.pathname === '/__mock/ag-ui' && req.method === 'POST') {
      await mockResponse(req, res, true);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      send(res, 405, 'text/plain', 'This preview never forwards writes to the upstream site.');
      return;
    }
    if (files[url.pathname]) {
      const [name, type] = files[url.pathname];
      send(res, 200, type, await fs.readFile(path.join(__dirname, name)));
      return;
    }
    if (url.pathname === '/__mock/config.json') {
      send(res, 200, 'application/json', JSON.stringify(sheet));
      return;
    }
    if (url.pathname === '/__internal__/livereload.js') {
      send(res, 200, 'text/javascript', 'console.info("Live reload is disabled in the isolated mock preview.");');
      return;
    }
    if (url.pathname === '/__mock/route.svg') {
      send(res, 200, 'image/svg+xml', routeImage);
      return;
    }
    if (url.pathname.startsWith('/__mock/')) {
      send(res, 404, 'text/plain', 'Local mock resource not found');
      return;
    }
    const response = await fetch(`${upstream}${url.pathname}${url.search}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const type = response.headers.get('content-type') || 'application/octet-stream';
    let payload = Buffer.from(await response.arrayBuffer());
    if (url.pathname === '/blocks/chat/chat.js') {
      const source = payload.toString('utf8');
      const endpointCall = 'fetch(config.agentEndpoint, requestForTurn())';
      if (source.split(endpointCall).length !== 3) {
        send(res, 502, 'text/plain', 'Cannot safely replace the chat endpoint; refusing to load the chat module.');
        return;
      }
      payload = Buffer.from(source.replaceAll(endpointCall, "fetch('/__mock/ag-ui', requestForTurn())"));
    }
    if (url.pathname === '/scripts/chat-auth.js') {
      const source = payload.toString('utf8');
      const singleton = 'export const chatAuth = createChatAuth();';
      if (!source.includes(singleton)) {
        send(res, 502, 'text/plain', 'Cannot safely isolate chat authentication.');
        return;
      }
      payload = Buffer.from(source.replace(singleton, "export { default as chatAuth } from '/__mock/auth.js';"));
    }
    if (type.includes('text/html') && response.ok) {
      const source = payload.toString('utf8');
      if (source.includes('</head>')) {
        payload = Buffer.from(source.replace('</head>', '<link id="mock-experimental-css" rel="stylesheet" href="/__mock/experimental.css"></head>'));
      }
    }
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "connect-src 'self'; form-action 'self'; base-uri 'self'",
      'X-Local-Mock': 'true',
    };
    const location = response.headers.get('location');
    if (location) headers.Location = location.replace(upstream, '');
    res.writeHead(response.status, headers);
    res.end(req.method === 'HEAD' ? undefined : payload);
  } catch (error) {
    console.error(`Local style preview: ${error.message}`);
    if (!res.headersSent) send(res, 502, 'text/plain', `Local preview failed: ${error.message}`);
    else res.destroy();
  }
});

server.on('error', (error) => {
  console.error(`Cannot start the local style lab: ${error.message}`);
  if (error.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the existing style lab first.`);
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local-only chat style lab: ${localURL}/__mock/preview.html`);
  console.log(`Synthetic AG-UI API: ${localURL}/__mock/ag-ui`);
  console.log('Repository files are read-only. Live chat calls are blocked by CSP.');
  console.log('Keep the AEM development proxy running on http://localhost:3000. Stop this server with Ctrl+C.');
});

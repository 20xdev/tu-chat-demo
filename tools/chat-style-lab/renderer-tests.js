import { createResponseRenderer, mergeResponseParts } from '../../scripts/chat-response.js';
import {
  answerParts, applyTurnEvent, createTurnState, followUpOptions,
  parseRoutePlan, readA2AStream, routeGeometry, turnFinished,
} from '../../scripts/chat-stream.js';
import createToolViews from '../../scripts/chat-tools.js';
import { parseHelpMedia, resolveHelpMediaURL } from '../../scripts/chat-help.js';
import { createAGUIRequest } from '../../scripts/chat-agui.js';
import migrationCases from './migration-tests.js';

const markdownURL = 'https://cdn.jsdelivr.net/npm/marked@18.1.0/lib/marked.esm.js';
const sanitizerURL = 'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.es.mjs';
const [{ marked }, { default: DOMPurify }] = await Promise.all([
  import(markdownURL), import(sanitizerURL),
]);
const render = createResponseRenderer(marked, DOMPurify);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="green"/></svg>';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const text = (value) => ({ kind: 'text', text: value });
const file = (value) => ({ kind: 'file', file: value });
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const decodeSVG = (image) => new DOMParser()
  .parseFromString(decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1)), 'image/svg+xml');
const expectFallback = (part, reason) => {
  const result = render([part]);
  assert(!result.querySelector('img'), 'Invalid source produced an image');
  assert(result.querySelector('.chat-image-fallback')?.textContent.includes(reason), 'Missing explanatory fallback');
};
const tool = (kind, value, id = 'tool-1') => ({
  kind: 'data', data: { toolData: { kind, toolUseId: id, value } },
});
const sampleRoute = {
  ok: true,
  origin: { label: 'Origin', position: [144.96, -37.81] },
  destination: { label: 'Destination', position: [144.85, -37.67] },
  distance_km: 22.7,
  duration_minutes: 19,
  tolled_distance_km: 6.1,
  untolled_distance_km: 16.6,
  toll_total: 3.41,
  currency: 'AUD',
  tolls: [{
    name: 'MELBOURNE CITYLINK',
    system: 'MELBOURNE CITYLINK',
    currency: 'AUD',
    amount: 3.41,
    estimate: false,
    payment_methods: ['Transponder'],
  }],
  toll_roads: [{ name: 'Tullamarine Fwy', number: 'M2' }],
  toll_payment_sites: [
    { name: 'Travancore', position: [144.93942, -37.78523] },
    { name: 'Brunswick West', position: [144.93786, -37.75851] },
  ],
  segments: [
    { tolled: false, points: [[144.96, -37.81], [144.95, -37.8]] },
    { tolled: true, points: [[144.9, -37.75], [144.85, -37.67]] },
  ],
  assumptions: ['Not a live quote'],
};
const sampleTrips = Array.from({ length: 10 }, (_, index) => ({
  trip_id: `DEMO-TRIP-${index + 1}`,
  date: 'Fri 2 Oct 2026',
  start: '6:05pm',
  finish: '6:09pm',
  road: 'Demo toll road',
  from: 'Demo origin',
  to: 'Demo destination',
  by: index < 7 ? 'no tag detected (matched by number plate)' : 'tag ending 0000',
  plate: 'DEMO',
  vehicle: 'Demo vehicle',
  toll_aud: 2.5,
  video_matching_fee_aud: index < 7 ? 0.75 : 0,
  total_aud: index < 7 ? 3.25 : 2.5,
  charged: 'Fri 2 Oct 2026 6:38pm',
  statement: index < 3 ? 'Not on a statement yet' : 'DEMO-STATEMENT',
}));
const sampleStatement = {
  found: true,
  statement_id: 'DEMO-STATEMENT-2026-09',
  statement_date: '2026-09-25',
  period: { from: '2026-08-25', to: '2026-09-24' },
  opening_balance: { amount_aud: 10, position: 'owing' },
  payments_received_aud: 10,
  trip_charges_aud: 17.5,
  fees_and_adjustments_aud: 0.24,
  fees_and_adjustments_label: 'Demo surcharge',
  video_matching_fees_aud: 3,
  total_charged_aud: 17.74,
  gst_included_aud: 1.61,
  closing_balance: { amount_aud: 17.74, position: 'owing' },
  trip_count: 7,
  status: 'Due',
  due_on: '2026-10-09',
  paid_on: null,
  lines: [
    ...Array.from({ length: 7 }, (_, index) => ({
      charged: `2026-09-0${index + 1}`,
      type: 'trip',
      details: `Fictional trip ${index + 1}`,
      amount_aud: 2.5,
      trip_id: `DEMO-TRIP-${index + 1}`,
      start: '7:41am',
      finish: '7:45am',
      by: index < 3 ? 'Demo tag A' : 'Matched by plate',
    })),
    {
      charged: '2026-09-08', type: 'payment', details: 'Demo payment', amount_aud: -10,
    },
    {
      charged: '2026-09-08', type: 'adjustment', details: 'Demo surcharge', amount_aud: 0.24,
    },
  ],
  trip_charges_by_tag: { 'Demo tag A': 7.5, 'Demo spare tag': 0, 'Matched by plate': 10 },
  notes: ['Fictional statement for testing.', 'Backend totals must not be recalculated.'],
};
const helpBase = 'https://assets.example.invalid/help/tags/';
const sampleHelp = {
  found: true,
  title: 'Installing your tag',
  steps: ['Insert the tag.', 'Check the position.'],
  media: [
    {
      type: 'image', src: '/help/tags/mini.svg', alt: 'Mini tag illustration', caption: 'Mini tag',
    },
    {
      type: 'image', src: '/help/tags/small.svg', alt: 'Small tag illustration', caption: 'Small tag',
    },
    { type: 'video', youtubeId: '7sT7hg396EQ', title: 'Tag installation video' },
  ],
};
const bundledHelp = {
  ...sampleHelp,
  topic: 'install',
  media: [
    ...['insert', 'position', 'angle'].flatMap((stage) => ['D', 'C'].map((tag) => ({
      type: 'image',
      src: `/help/tags/${tag}-type-tag-${stage}-car.svg`,
      alt: `${tag}-type tag: ${stage}`,
      caption: `${tag}-type tag: ${stage}`,
    }))),
    sampleHelp.media[2],
  ],
};
const sampleOutcome = {
  status: 'outcome',
  outcome: 'no_holder',
  advice: 'Demo advice: use the holder in the illustrated position.',
  offer: {
    action: 'order_replacement_tag',
    item: 'holder',
    prompt: 'Would you like a demo tag holder?',
  },
  media: bundledHelp.media.filter((entry) => entry.src?.includes('position')),
};
const sampleQuestion = {
  status: 'question',
  step: 'beeping',
  question: 'Does your demo tag beep at a toll point?',
  options: ['Yes', 'No'],
  media: [],
  account_check: {
    tag_number_ending: '9999',
    status: 'Active',
    last_known_plate: 'DEMO-01',
    last_detected: '1 October 2026',
    trips_matched_by_plate_since: 7,
    summary: 'Fictional demo tag: recent trips were matched by plate.',
  },
};
function helpViews(value, base = '') {
  const host = document.createElement('div');
  const view = createToolViews(host, () => {}, base);
  view.update(new Map([['helpMedia:t', { kind: 'helpMedia', value }]]));
  return { host, view };
}
function status(parts, state = 'working') {
  return { kind: 'status-update', status: { state, message: { role: 'agent', parts } } };
}
function apply(state, result) {
  applyTurnEvent(state, { result });
}
function streamOf(source, size = 1) {
  const bytes = new TextEncoder().encode(source);
  return new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += size) {
        controller.enqueue(bytes.slice(index, index + size));
      }
      controller.close();
    },
  });
}
function waitFor(condition, description) {
  return new Promise((resolve, reject) => {
    let timer;
    const timeout = setTimeout(() => {
      clearInterval(timer);
      reject(new Error(`Timed out: ${description}`));
    }, 15000);
    timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        clearTimeout(timeout);
        resolve();
      }
    }, 25);
  });
}

async function loadImage(part, width) {
  const result = render([part]);
  const image = result.querySelector('img');
  assert(image, 'Image was not rendered');
  image.loading = 'eager';
  const host = document.createElement('div');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Image load timed out')), 5000);
    image.addEventListener('load', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    image.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Image failed to load'));
    }, { once: true });
    host.append(result);
    document.body.append(host);
  }).finally(() => host.remove());
  assert(image.naturalWidth === width, `Expected natural width ${width}, got ${image.naturalWidth}`);
}

const cases = [
  ['Split Markdown text is coalesced without changing the input', () => {
    const previous = [text('![A route](')];
    const result = mergeResponseParts(previous, [text('/__mock/route.svg)')], true);
    assert(previous[0].text === '![A route](', 'Input was mutated');
    assert(result.length === 1 && render(result).querySelector('img'), 'Split Markdown was not reassembled');
  }],
  ['Mixed parts retain text/image/text order across appended chunks', () => {
    const previous = mergeResponseParts([], [text('Before'), file({ uri: '/__mock/route.svg' })], false);
    const result = render(mergeResponseParts(previous, [text('After')], true));
    assert([...result.children].map((element) => element.tagName).join() === 'P,IMG,P', 'Mixed parts lost their order');
  }],
  ['Replacement updates replace old attachments', () => {
    const result = mergeResponseParts([file({ uri: '/old.svg' })], [text('New answer')], false);
    assert(result.length === 1 && result[0].text === 'New answer', 'Old attachment survived replacement');
  }],
  ['Markdown tables, inline links and fenced SVG code remain unchanged', () => {
    const result = render([text(`${'| A | B |\\n|---|---|\\n| 1 | 2 |'.replaceAll('\\n', '\n')
    }\n\nSee [details](/using-toll-roads).\n\n\`\`\`svg\n${svg}\n\`\`\``)]);
    assert(result.querySelector('table') && result.querySelector('p a'), 'Markdown formatting was lost');
    assert(result.querySelector('pre code').textContent.includes('<svg'), 'SVG code block was interpreted');
    assert(!result.querySelector('img'), 'Code block became an image');
  }],
  ['A2A URL image files load', () => loadImage(file({ mimeType: 'image/svg+xml', uri: '/__mock/route.svg' }), 760)],
  ['Base64 PNG files load at their natural size', () => loadImage(file({ mimeType: 'image/png', bytes: png }), 1)],
  ['Base64 SVG icon files load', () => loadImage(file({ mimeType: 'image/svg+xml', bytes: btoa(svg) }), 24)],
  ['UTF-8 SVG text is preserved in base64 files', () => {
    const source = svg.replace('</svg>', '<text x="1" y="12">\u2713</text></svg>');
    const bytes = btoa(String.fromCharCode(...new TextEncoder().encode(source)));
    const clean = decodeSVG(render([file({ mimeType: 'image/svg+xml', bytes })]).querySelector('img'));
    assert(clean.querySelector('text').textContent === '\u2713', 'Unicode SVG text was corrupted');
  }],
  ['Decorative Markdown images keep their empty alt text', () => {
    assert(render([text('![](/__mock/route.svg)')]).querySelector('img').alt === '', 'Empty alt text was changed');
  }],
  ['Relative and HTTP(S) image URLs are accepted', () => {
    ['/__mock/route.svg', 'http://example.invalid/image.png', 'https://example.invalid/icon.svg'].forEach((uri) => {
      assert(render([file({ uri })]).querySelector('img'), `Image URL was rejected: ${uri}`);
    });
  }],
  ['Raw SVG text loads as a static image, not inline SVG', async () => {
    assert(!render([text(svg)]).querySelector('svg'), 'Inline SVG reached the page');
    await loadImage(text(svg), 24);
  }],
  ['Markdown and HTML data URL images load', async () => {
    await Promise.all([
      loadImage(text(`![Pixel](data:image/png;base64,${png})`), 1),
      loadImage(text(`<img src="data:image/svg+xml,${encodeURIComponent(svg)}" alt="Icon">`), 24),
    ]);
  }],
  ['Static SVG preserves viewBox, gradients and local references', () => {
    const source = svg.replace('<path', '<defs><linearGradient id="g"><stop offset="0" stop-color="green"/></linearGradient></defs><path')
      .replace('fill="green"', 'fill="url(#g)"');
    const clean = decodeSVG(render([file({ mimeType: 'image/svg+xml', bytes: btoa(source) })]).querySelector('img'));
    assert(clean.documentElement.getAttribute('viewBox') === '0 0 24 24', 'viewBox was lost');
    assert(clean.querySelector('linearGradient') && clean.querySelector('path').getAttribute('fill') === 'url(#g)', 'Local SVG definitions were lost');
  }],
  ['SVG active content and external references are removed', () => {
    const source = svg.replace('<path', '<script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><animate attributeName="x"/><use href="https://example.invalid/icons.svg#car"/><path onload="alert(1)" style="fill:red"')
      .replace('fill="green"', 'fill="url(https://example.invalid/paint.svg#g)"');
    const clean = decodeSVG(render([file({ mimeType: 'image/svg+xml', bytes: btoa(source) })]).querySelector('img'));
    assert(!clean.querySelector('script,foreignObject,animate,[onload],[style],[href]'), 'Active SVG content survived');
    assert(!clean.querySelector('path').hasAttribute('fill'), 'External SVG paint survived');
  }],
  ['Unsafe HTML is removed', () => {
    const result = render([text('<script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)"><a href="javascript:alert(1)">bad link</a>')]);
    assert(!result.querySelector('script,[onerror],[href],[src]'), 'Unsafe HTML survived');
    assert(result.querySelector('.chat-image-fallback'), 'Blocked HTML image had no fallback');
  }],
  // eslint-disable-next-line no-script-url -- Intentional invalid-source regression cases.
  ...['javascript:alert(1)', 'blob:https://example.com/123', 'file:///etc/passwd', 'data:text/html;base64,PHNjcmlwdD4=']
    .map((uri) => [`Blocked image source: ${uri.split(':')[0]}`, () => expectFallback(file({ uri }), 'Unsupported')]),
  ['Invalid base64 has an explanatory fallback', () => expectFallback(file({ mimeType: 'image/png', bytes: '**invalid**' }), 'Invalid base64')],
  ['Invalid SVG has an explanatory fallback', () => expectFallback(file({ mimeType: 'image/svg+xml', bytes: btoa('<svg>broken') }), 'Invalid SVG')],
  ['Invalid SVG URL encoding has an explanatory fallback', () => expectFallback(file({ uri: 'data:image/svg+xml,%ZZ' }), 'Invalid SVG encoding')],
  ['Invalid UTF-8 SVG bytes have an explanatory fallback', () => expectFallback(file({ mimeType: 'image/svg+xml', bytes: btoa('\xff') }), 'Invalid SVG encoding')],
  ['Missing image sources have an explanatory fallback', () => expectFallback(file({ name: 'Missing image' }), 'Expected')],
  ['Non-image attachments have an explanatory fallback', () => expectFallback(file({ mimeType: 'application/pdf', uri: '/document.pdf' }), 'Unsupported')],
  ['Conflicting URI and bytes are rejected', () => expectFallback(file({ mimeType: 'image/png', uri: '/image.png', bytes: png }), 'Expected')],
  ['Unknown structured data has an explanatory fallback', () => expectFallback({ kind: 'data', data: { icon: 'car' } }, 'Expected text or an image file')],
  ['The 5 MiB inline limit includes its boundary', () => {
    const encoded = 'AAAA'.repeat(Math.floor((5 * 1024 * 1024) / 3));
    assert(render([file({ mimeType: 'image/png', bytes: `${encoded}AAA=` })]).querySelector('img'), 'Exact 5 MiB payload was rejected');
    expectFallback(file({ mimeType: 'image/png', bytes: `${encoded}AAAA` }), '5 MiB');
  }],
  ['Failed image loads become readable fallbacks', async () => {
    const result = render([file({ name: 'Broken route', uri: '/__mock/missing-route.png' })]);
    const image = result.querySelector('img');
    image.dispatchEvent(new Event('error'));
    assert(result.querySelector('.chat-image-fallback')?.textContent.includes('Broken route: Image could not be loaded.'), 'Load failure was not explained');
  }],
  ['Requests preserve authentication, method, text and conversation identity', () => {
    const first = createAGUIRequest('First question', 'conversation-1', 'session-1', 'fixture-token');
    const second = createAGUIRequest('Second question', 'conversation-1', 'session-1', 'fixture-token');
    const a = JSON.parse(first.body);
    const b = JSON.parse(second.body);
    assert(first.method === 'POST' && first.headers.Authorization === 'Bearer fixture-token', 'Authentication changed');
    assert(a.threadId === b.threadId, 'Conversation identity changed');
    assert(a.runId !== b.runId && a.messages[0].id !== b.messages[0].id, 'IDs were reused');
    assert(b.messages[0].content === 'Second question', 'Question was changed');
  }],
  ['Provisional text is replaced by the final artifact without losing route data', () => {
    const state = createTurnState('c');
    apply(state, status([text('Preparing...'), tool('routePlan', sampleRoute)]));
    apply(state, { kind: 'artifact-update', artifact: { artifactId: 'a', parts: [text('Final answer')] }, lastChunk: true });
    assert(answerParts(state).length === 1 && answerParts(state)[0].text === 'Final answer', 'Answer was duplicated');
    assert(state.tools.size === 1 && state.artifacts.get('a').lastChunk, 'Route or lastChunk was lost');
    assert(!turnFinished(state), 'Artifact completion was confused with task completion');
  }],
  ['Artifacts append and replace while preserving text spacing', () => {
    const state = createTurnState('c');
    apply(state, { kind: 'artifact-update', artifact: { artifactId: 'a', parts: [text('A ')] } });
    apply(state, { kind: 'artifact-update', append: true, artifact: { artifactId: 'a', parts: [text(' B')] } });
    assert(answerParts(state)[0].text === 'A  B', 'Text fragments were trimmed');
    apply(state, { kind: 'artifact-update', append: false, artifact: { artifactId: 'a', parts: [text('Replacement')] } });
    assert(answerParts(state)[0].text === 'Replacement', 'Replacement was appended');
  }],
  ['Task snapshots collect artifacts but not user history', () => {
    const state = createTurnState('c');
    apply(state, {
      kind: 'task', id: 'task-1', history: [{ role: 'user', parts: [text('Do not display')] }], status: { state: 'completed' }, artifacts: [{ artifactId: 'a', parts: [text('Snapshot answer')] }],
    });
    assert(answerParts(state)[0].text === 'Snapshot answer' && turnFinished(state), 'Task snapshot failed');
    assert(!JSON.stringify(answerParts(state)).includes('Do not display'), 'User history became an answer');
  }],
  ['Direct image-only messages complete successfully', () => {
    const state = createTurnState('c');
    apply(state, { kind: 'message', parts: [file({ uri: '/__mock/route.svg' })] });
    assert(turnFinished(state) && answerParts(state)[0].kind === 'file', 'Image-only response was lost');
  }],
  ['Routes and follow-ups are collected from every supported part location', () => {
    [
      status([tool('routePlan', sampleRoute)]),
      { kind: 'artifact-update', artifact: { artifactId: 'a', parts: [tool('routePlan', sampleRoute)] } },
      { kind: 'message', parts: [tool('routePlan', sampleRoute)] },
      { kind: 'task', artifacts: [{ artifactId: 'a', parts: [tool('routePlan', sampleRoute)] }] },
    ].forEach((event) => {
      const state = createTurnState('c');
      apply(state, event);
      assert(state.tools.size === 1, 'Structured part was discarded');
    });
  }],
  ['Repeated tool events retain stable views and changed values upsert', () => {
    const state = createTurnState('c');
    apply(state, status([tool('routePlan', sampleRoute)]));
    const first = state.tools.get('routePlan:tool-1');
    apply(state, status([tool('routePlan', JSON.parse(JSON.stringify(sampleRoute)))]));
    assert(state.tools.size === 1 && state.tools.get('routePlan:tool-1') === first, 'Repeated route was recreated');
    apply(state, status([tool('routePlan', { ...sampleRoute, ok: false })]));
    assert(state.tools.size === 1 && state.tools.get('routePlan:tool-1') !== first, 'Changed route did not upsert');
  }],
  ['Unknown data and tool progress do not render as errors', () => {
    const state = createTurnState('c');
    apply(state, status([text('Answer'), { kind: 'data', data: { toolEvent: { phase: 'start' } } }, tool('unknown', {}), { kind: 'data', data: { arbitrary: true } }]));
    assert(state.tools.size === 0 && answerParts(state).length === 1, 'Internal events leaked into the answer');
  }],
  ['Wrong conversation and task events cannot change the active turn', () => {
    const state = createTurnState('c');
    apply(state, { ...status([text('Correct')]), contextId: 'c', taskId: 'a' });
    apply(state, { ...status([text('Wrong conversation')]), contextId: 'other', taskId: 'a' });
    apply(state, { ...status([text('Wrong task')]), contextId: 'c', taskId: 'b' });
    assert(answerParts(state)[0].text === 'Correct', 'Late response polluted another turn');
    const other = createTurnState('other');
    assert(answerParts(other).length === 0 && other.tools.size === 0, 'Turn state was shared');
  }],
  ['Premature closure and final working status are not successful completion', () => {
    const state = createTurnState('c');
    apply(state, status([text('Partial')]));
    assert(!turnFinished(state), 'Partial content was declared complete');
    apply(state, { ...status([], 'working'), final: true });
    assert(!turnFinished(state), 'Nonterminal final event was declared complete');
  }],
  ['Completed and action-required states stop loading correctly', () => {
    ['completed', 'input-required', 'auth-required'].forEach((outcome) => {
      const state = createTurnState('c');
      apply(state, status([text('Response')], outcome));
      assert(turnFinished(state), `State ${outcome} did not finish its response`);
    });
  }],
  ['Task failures and JSON-RPC errors preserve existing partial content', () => {
    ['failed', 'canceled', 'rejected', 'rpc-error'].forEach((outcome) => {
      const state = createTurnState('c');
      apply(state, status([text('Partial')]));
      let failed = false;
      try {
        if (outcome === 'rpc-error') applyTurnEvent(state, { error: { code: -32603 } });
        else apply(state, status([], outcome));
      } catch { failed = true; }
      assert(failed && answerParts(state)[0].text === 'Partial', 'Failure discarded partial content');
    });
  }],
  ['SSE handles byte-split UTF-8, CRLF, multiline JSON and comments', async () => {
    const state = createTurnState('c');
    const payload = JSON.stringify({ result: { kind: 'message', parts: [text('A \u{1F7E2} route')] } });
    const source = `: comment\r\ndata: ${payload.slice(0, 10)}\r\ndata: ${payload.slice(10)}\r\n\r\n`;
    await readA2AStream(streamOf(source), (event) => {
      applyTurnEvent(state, event);
      return state.closed;
    });
    assert(answerParts(state)[0].text === 'A \u{1F7E2} route', 'UTF-8 or multiline SSE failed');
  }],
  ['SSE handles CR-only delimiters and an unterminated final event', async () => {
    let count = 0;
    await readA2AStream(streamOf('data: {"result":{}}\r\rdata: {"result":{}}'), () => { count += 1; });
    assert(count === 2, 'SSE event boundaries were lost');
  }],
  ['Legacy DONE marker is not task completion', async () => {
    const state = createTurnState('c');
    await readA2AStream(streamOf('data: [DONE]\n\n'), (event) => applyTurnEvent(state, event));
    assert(!turnFinished(state), 'DONE marker falsely completed a task');
  }],
  ['Malformed JSON and post-content JSON-RPC errors fail the SSE read', async () => {
    await Promise.all([
      'data: invalid\n\n',
      `data: ${JSON.stringify({ result: status([text('Partial')]) })}\n\ndata: {"error":{"code":-32603}}\n\n`,
    ].map(async (source) => {
      const state = createTurnState('c');
      let failed = false;
      try {
        await readA2AStream(streamOf(source), (event) => applyTurnEvent(state, event));
      } catch {
        failed = true;
      }
      assert(failed, 'Malformed stream was treated as successful');
    }));
  }],
  ['Route coordinate order, segment boundaries and bounds are preserved', () => {
    const geometry = routeGeometry(parseRoutePlan(sampleRoute));
    assert(geometry.origin.join() === '-37.81,144.96', 'Longitude and latitude were reversed');
    assert(geometry.segments.length === 2 && geometry.segments[0].points.length === 2, 'Segments were joined');
    assert(!geometry.segments[0].tolled && geometry.segments[1].tolled, 'Road classifications were lost');
    assert(geometry.bounds.length === 8, 'Bounds omitted route points or markers');
  }],
  ['Hundreds of route coordinates are preserved without simplification', () => {
    const points = Array.from({ length: 900 }, (_, index) => [144 + index / 10000, -37]);
    const route = parseRoutePlan({ ...sampleRoute, segments: [{ tolled: true, points }] });
    const geometry = routeGeometry(route);
    const preserved = geometry.segments[0].points.length === 900 && geometry.bounds.length === 904;
    assert(preserved, 'Route points were dropped');
  }],
  ['Missing, unsuccessful and malformed routes never become fake maps', () => {
    [null, {}, { ...sampleRoute, ok: false }, { ...sampleRoute, segments: [] }].forEach((value) => {
      assert(parseRoutePlan(value).error, 'Invalid route was accepted');
    });
    [[null, -37], ['144', -37], [0, NaN], [181, 0], [144, -91]].forEach((position) => {
      const result = parseRoutePlan({ ...sampleRoute, origin: { label: 'Bad', position } });
      assert(result.error, 'Invalid coordinates were coerced');
    });
  }],
  ['Malformed segments and metrics are not coerced', () => {
    const bad = {
      ...sampleRoute,
      segments: [{ tolled: true, points: [[144, -37], [null, -37], [145, -37]] }],
    };
    assert(parseRoutePlan(bad).error, 'Invalid middle point was joined across');
    const valid = parseRoutePlan({ ...sampleRoute, distance_km: '24.7', toll_total: -1 });
    assert(valid.distance === null && valid.toll === null, 'Invalid estimates were coerced');
    assert(valid.assumptions[0] === 'Not a live quote', 'Pricing assumptions were lost');
  }],
  ['Route card metadata preserves supplied tolls, roads and currencies without coercion', () => {
    const route = parseRoutePlan(sampleRoute);
    assert(
      route.tolls[0].name === 'MELBOURNE CITYLINK' && route.tolls[0].amount === 3.41,
      'Toll breakdown was lost',
    );
    assert(
      route.tollRoads[0] === 'Tullamarine Fwy (M2)' && !route.incompleteDetails,
      'Road labels were changed or marked invalid',
    );
    const malformed = parseRoutePlan({
      ...sampleRoute,
      tolls: [null, { name: 'Invalid', amount: '3.41' }, { name: 'Invalid', amount: 3, currency: 'bad-code' }],
      toll_roads: [{ name: 'Invalid', number: 42 }],
    });
    assert(
      !malformed.error && malformed.incompleteDetails
      && !malformed.tolls.length && !malformed.tollRoads.length,
      'Optional invalid details were coerced or discarded valid geometry',
    );
  }],
  ['Map-first route cards use compact pricing and plain-text reference labels', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['route:t', { kind: 'routePlan', value: sampleRoute }]]));
    const card = host.querySelector('.chat-route');
    assert(card.firstElementChild.classList.contains('chat-route-map'), 'Map was not first in the card');
    assert(
      card.querySelector('.chat-route-places').textContent === 'Origin \u2192 Destination',
      'Route title did not match the reference layout',
    );
    assert(
      card.querySelector('.chat-route-trip-meta').textContent === '22.7 km \u00b7 19 min',
      'Trip metrics did not use the compact layout',
    );
    assert(
      card.querySelector('.chat-route-total').textContent === '$3.41',
      'Toll total lost its currency or precision',
    );
    assert(
      card.querySelector('.chat-route-tolled').textContent === '6.1 km on Tullamarine Fwy (M2)',
      'Tolled road detail was omitted',
    );
    assert(
      card.querySelector('.chat-route-untolled').getAttribute('aria-label').includes('Dashed'),
      'Line classifications lost their accessible description',
    );
    assert(
      card.querySelector('.chat-route-estimate').textContent.includes('Not a guaranteed'),
      'Pricing disclaimer was removed',
    );
    view.update(new Map([['route:t', {
      kind: 'routePlan',
      value: {
        ...sampleRoute,
        origin: { ...sampleRoute.origin, label: '<img src=x onerror=alert(1)>' },
        currency: undefined,
        tolls: [{ name: '<b>Not markup</b>', amount: 3.41 }],
      },
    }]]));
    assert(
      !host.querySelector('.chat-route-places img,.chat-route-toll-name b'),
      'Route labels became active markup',
    );
    assert(
      host.querySelector('.chat-route-total').textContent === '3.41 (currency not supplied)',
      'Missing currency was guessed or rounded',
    );
    view.dispose();
  }],
  ['All supplied toll metadata and payment sites reach the card and map model', () => {
    const route = parseRoutePlan(sampleRoute);
    assert(
      route.tolls[0].system === 'MELBOURNE CITYLINK' && route.tolls[0].estimate === false
      && route.tolls[0].paymentMethods.join() === 'Transponder',
      'Toll system, false estimate flag or payment methods were dropped',
    );
    const geometry = routeGeometry(route);
    assert(
      geometry.paymentSites.length === 2
      && geometry.paymentSites[0].position.join() === '-37.78523,144.93942'
      && geometry.paymentSites[1].name === 'Brunswick West',
      'Payment site positions or coordinate order were lost',
    );
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['route:t', { kind: 'routePlan', value: sampleRoute }]]));
    const metadata = host.querySelector('.chat-route-toll-meta').textContent;
    assert(
      metadata.includes('System: MELBOURNE CITYLINK') && metadata.includes('Estimated: No')
      && metadata.includes('Currency: AUD') && metadata.includes('Payment methods: Transponder'),
      'Validated toll metadata did not appear on screen',
    );
    const sites = host.querySelector('.chat-route-payment-sites').textContent;
    assert(
      sites.includes('Travancore') && sites.includes('Brunswick West')
      && sites.includes('-37.78523, 144.93942') && sites.includes('-37.75851, 144.93786'),
      'Named payment sites or their coordinates were not shown',
    );
    view.dispose();
  }],
  ['Malformed optional toll metadata and payment sites warn without losing valid details', () => {
    const route = parseRoutePlan({
      ...sampleRoute,
      tolls: [{
        ...sampleRoute.tolls[0], system: 42, estimate: 'false', payment_methods: ['Transponder', null],
      }],
      toll_payment_sites: [...sampleRoute.toll_payment_sites, { name: 'Invalid', position: [181, 0] }],
    });
    assert(
      !route.error && route.incompleteDetails && route.paymentSites.length === 2
      && route.tolls[0].system === null && route.tolls[0].estimate === null
      && route.tolls[0].paymentMethods.join() === 'Transponder',
      'Invalid optional values were coerced or valid details were discarded',
    );
    const missing = parseRoutePlan({
      ...sampleRoute, tolls: [{ name: 'Toll', amount: 0 }], toll_payment_sites: undefined,
    });
    assert(
      !missing.incompleteDetails && !missing.paymentSites.length
      && missing.tolls[0].estimate === null && !missing.tolls[0].paymentMethods.length,
      'Missing optional fields were invented or flagged invalid',
    );
  }],
  ['Malformed optional pricing details display a warning while retaining the map', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['route:t', {
      kind: 'routePlan', value: { ...sampleRoute, tolls: 'invalid' },
    }]]));
    assert(
      host.querySelector('.chat-route-map')
      && host.querySelector('.chat-tool-fallback').textContent.includes('toll details'),
      'Incomplete optional pricing was silently hidden or removed the map',
    );
    view.dispose();
  }],
  ['Statement cards render all balances, transaction fields, tag charges and notes', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['statement:s', { kind: 'statementCard', value: sampleStatement }]]));
    const card = host.querySelector('.chat-statement');
    const facts = [...card.querySelectorAll('.chat-statement-summary:not(.chat-statement-tags) dt')]
      .map((label) => [label.textContent, label.nextElementSibling.textContent]);
    const factMap = new Map(facts);
    assert(
      factMap.get('Total charged') === '$17.74'
      && factMap.get('Video matching fees (reported)') === '$3.00'
      && factMap.get('Opening balance') === '$10.00 (owing)'
      && factMap.get('Closing balance') === '$17.74 (owing)',
      'Statement balances were lost or fees were added to the supplied total',
    );
    assert(
      factMap.get('Payments received') === '$10.00' && factMap.get('Trip charges') === '$17.50'
      && factMap.get('Demo surcharge') === '$0.24' && factMap.get('GST included') === '$1.61'
      && factMap.get('Trips') === '7' && factMap.get('Status') === 'Due'
      && factMap.get('Due date') === '9 Oct 2026'
      && factMap.get('Statement period') === 'From 25 Aug 2026 to 24 Sept 2026',
      'Statement summary omitted supplied fields',
    );
    const rows = card.querySelectorAll('tbody tr');
    assert(rows.length === 9 && rows[7].textContent.includes('-$10.00'), 'Transaction rows or negative payment were lost');
    ['DEMO-TRIP-1', '7:41am', '7:45am', 'Demo tag A', 'Type: trip'].forEach((value) => {
      assert(rows[0].textContent.includes(value), `Missing transaction detail: ${value}`);
    });
    assert(
      card.querySelector('.chat-statement-id').textContent === sampleStatement.statement_id
      && card.querySelector('.chat-statement-title').textContent.includes('25 Sept 2026')
      && card.querySelector('.chat-statement-tags').textContent.includes('Demo spare tag$0.00')
      && card.querySelectorAll('.chat-statement-notes li').length === 2,
      'Statement identity, zero-value spare tag or notes were dropped',
    );
    assert(!card.querySelector('.chat-tool-fallback'), 'Valid statement was marked incomplete');
    const original = card;
    view.update(new Map([['statement:s', { kind: 'statementCard', value: sampleStatement }]]));
    // Tool identity, rather than value identity, controls replacement.
    assert(host.querySelectorAll('.chat-statement').length === 1, 'Repeated statement duplicated the card');
    assert(original !== host.querySelector('.chat-statement'), 'Updated tool object was not rendered');
    view.dispose();
    assert(!host.hasChildNodes(), 'Statement remained after disposal');
  }],
  ['Statements preserve paid/credit/zero states and treat supplied markup as plain text', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const markup = '<img src=x onerror=alert(1)>';
    view.update(new Map([['statement:s', {
      kind: 'statementCard',
      value: {
        ...sampleStatement,
        statement_id: markup,
        status: 'Paid',
        paid_on: '2026-10-01',
        closing_balance: { amount_aud: 0, position: 'credit' },
        lines: [{ ...sampleStatement.lines[0], details: markup, by: markup }],
        trip_charges_by_tag: { [markup]: 0 },
        notes: [markup],
      },
    }]]));
    assert(
      !host.querySelector('img,script') && host.textContent.includes(markup)
      && host.textContent.includes('1 Oct 2026') && host.textContent.includes('$0.00 (credit)'),
      'Statement labels became markup or valid paid/credit/zero data was lost',
    );
    view.dispose();
  }],
  ['Statement hero uses the supplied balance or total without guessing a payment state', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const update = (value) => view.update(new Map([['statement:s', { kind: 'statementCard', value }]]));
    update({ ...sampleStatement, closing_balance: { amount_aud: 0, position: 'credit' }, status: 'Paid' });
    assert(
      host.querySelector('.chat-statement-balance-amount').textContent === '$0.00'
      && host.querySelector('.chat-statement-position').textContent.includes('credit')
      && host.querySelector('.chat-statement-status').dataset.status === 'paid',
      'Zero balance, credit position or supplied status was replaced with a due amount',
    );
    update({ ...sampleStatement, closing_balance: undefined });
    assert(
      host.querySelector('.chat-statement-primary dt').textContent === 'Total charged'
      && host.querySelector('.chat-statement-primary dd').textContent === '$17.74',
      'Missing closing balance did not fall back to the explicitly supplied total',
    );
    update({ ...sampleStatement, closing_balance: undefined, total_charged_aud: undefined });
    assert(!host.querySelector('.chat-statement-primary dd'), 'Missing balances became a fabricated zero');
    view.dispose();
  }],
  ['Malformed or unavailable statements show explicit fallbacks without inventing amounts', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    [null, { found: false }].forEach((value) => {
      view.update(new Map([['statement:s', { kind: 'statementCard', value }]]));
      assert(host.textContent.includes('Statement information is unavailable.'), 'Missing statement became a fake card');
    });
    view.update(new Map([['statement:s', {
      kind: 'statementCard',
      value: {
        ...sampleStatement,
        statement_date: '2026-02-30',
        total_charged_aud: '17.74',
        trip_count: '7',
        notes: {},
        trip_charges_by_tag: { Invalid: '0' },
        lines: [null, { ...sampleStatement.lines[0], amount_aud: '2.50' }],
      },
    }]]));
    assert(
      host.querySelector('.chat-tool-fallback').textContent.includes('incomplete or invalid')
      && host.textContent.includes('Amount unavailable')
      && !host.textContent.includes('NaN') && !host.textContent.includes('Invalid Date'),
      'Malformed values were coerced or silently discarded',
    );
    assert(host.querySelectorAll('tbody tr').length === 1, 'Valid transaction details were discarded with a bad amount');
    assert(
      host.querySelector('.chat-statement-entry-count').textContent.includes('1 entry'),
      'Transaction caption counted rejected rows or used the wrong singular label',
    );
    view.dispose();
  }],
  ['Trip lists preserve all ten entries, their order, metadata and supplied prices', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['trips:t', { kind: 'tripList', value: { trips: sampleTrips } }]]));
    const items = [...host.querySelectorAll('.chat-trip-item')];
    assert(items.length === 10 && host.querySelector('.chat-trip-count').textContent === '10 trips \u00b7 AUD', 'Trips were truncated');
    items.forEach((item, index) => {
      const trip = sampleTrips[index];
      [
        trip.trip_id, trip.date, trip.start, trip.finish, trip.road, trip.from, trip.to,
        trip.by, trip.plate, trip.vehicle, trip.charged, trip.statement,
      ].forEach((value) => assert(item.textContent.includes(value), `Trip field was omitted: ${value}`));
      assert(
        item.querySelector('.chat-trip-total').textContent === (index < 7 ? '$3.25' : '$2.50')
        && item.querySelector('.chat-trip-pricing').textContent.includes('Toll: $2.50')
        && item.querySelector('.chat-trip-pricing').textContent.includes(index < 7 ? '$0.75' : '$0.00')
        && item.querySelector('.chat-trip-badge').textContent === (index < 7 ? 'Plate' : 'Tag'),
        'Trip prices were recomputed, zeros omitted, or detection labels changed',
      );
    });
    assert(!host.querySelector('.chat-tool-fallback,details,[hidden]'), 'Valid trip details were marked invalid or collapsed');
    view.dispose();
    assert(!host.hasChildNodes(), 'Disposed trip list remained visible');
  }],
  ['Empty and malformed trip lists show explicit results without guessed prices', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const update = (value) => view.update(new Map([['trips:t', { kind: 'tripList', value }]]));
    update({ trips: [] });
    assert(host.textContent.includes('No trips were returned.') && !host.querySelector('.chat-tool-fallback'), 'Empty list became an error or fabricated trip');
    [null, {}, { trips: 'invalid' }].forEach((value) => {
      update(value);
      assert(host.querySelector('.chat-tool-fallback'), 'Malformed trip list silently disappeared');
    });
    update({
      trips: [null, {
        ...sampleTrips[0], toll_aud: '2.50', video_matching_fee_aud: null, total_aud: '3.25',
      }],
    });
    assert(
      host.querySelectorAll('.chat-trip-item').length === 1
      && host.querySelector('.chat-trip-total').textContent === 'Total unavailable'
      && host.querySelector('.chat-trip-pricing').textContent.includes('Toll: unavailable')
      && host.querySelector('.chat-tool-fallback').textContent.includes('incomplete or invalid'),
      'Invalid trip values were coerced or usable entries discarded',
    );
    view.dispose();
  }],
  ['Trip labels remain plain text and unknown detection methods are not guessed', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const markup = '<img src=x onerror=alert(1)>';
    view.update(new Map([['trips:t', {
      kind: 'tripList',
      value: {
        trips: [{
          ...sampleTrips[0], road: markup, plate: markup, by: markup,
        }],
      },
    }]]));
    assert(
      !host.querySelector('img,script,.chat-trip-badge') && host.textContent.includes(markup),
      'Trip labels became active HTML or unknown detection was classified',
    );
    view.dispose();
  }],
  ['Unavailable trip cards show a neutral result alongside empty trips and follow-ups', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const tools = new Map([
      ['tripCard:missing', { kind: 'tripCard', value: { found: false } }],
      ['tripList:empty', { kind: 'tripList', value: { trips: [] } }],
      ['followUps:dispute', { kind: 'followUps', value: { options: ['Check my dispute status'] } }],
    ]);
    view.update(tools);
    const card = host.querySelector('.chat-trip-unavailable');
    view.update(tools);
    assert(
      host.querySelectorAll('.chat-trip-unavailable').length === 1
      && host.querySelector('.chat-trip-unavailable') === card
      && card.textContent.includes('Trip details could not be found')
      && host.textContent.includes('No trips were returned.')
      && host.querySelector('button').textContent === 'Check my dispute status'
      && !host.querySelector('.chat-tool-fallback'),
      'Unavailable trip duplicated, warned, hid the empty list or lost follow-ups',
    );
    view.dispose();
    assert(!host.hasChildNodes(), 'Unavailable trip survived disposal');
  }],
  ['Follow-up options are validated and deduplicated', () => {
    assert(followUpOptions({ options: [' Ask ', '', null, 'Ask', 42, 'Other'] }).join() === 'Ask,Other', 'Follow-up validation failed');
  }],
  ['Follow-up buttons use normal text, upsert, disable and clean up', () => {
    const host = document.createElement('div');
    const sent = [];
    const view = createToolViews(host, (option) => sent.push(option));
    const tools = new Map([['followUps:t', { kind: 'followUps', value: { options: ['Ask again', 'Another route'] } }]]);
    view.update(tools);
    const button = host.querySelector('button');
    view.update(tools);
    assert(host.querySelectorAll('button').length === 2 && button.type === 'button', 'Buttons duplicated or submit the wrong form');
    view.setBusy(true);
    button.dispatchEvent(new Event('click'));
    assert(sent.length === 0 && button.disabled, 'Busy button submitted');
    view.setBusy(false);
    button.click();
    assert(sent.join() === 'Ask again', 'Follow-up text changed');
    view.dispose();
    button.dispatchEvent(new Event('click'));
    assert(sent.length === 1 && !host.hasChildNodes(), 'Disposed suggestion submitted');
  }],
  ['Invalid route views retain an explanatory fallback without loading a provider', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['route:t', { kind: 'routePlan', value: { ok: false } }]]));
    assert(host.querySelector('.chat-tool-fallback') && !host.querySelector('.chat-route-map'), 'Invalid route showed a map');
    view.dispose();
  }],
  ['Help parsing preserves the supplied title, ordered steps and media order', () => {
    const help = parseHelpMedia(sampleHelp);
    assert(help.found && help.title === sampleHelp.title, 'Help success or title was lost');
    assert(help.steps.join() === sampleHelp.steps.join(), 'Help steps were reordered');
    assert(help.media[0].caption === 'Mini tag' && help.media[2].type === 'video', 'Media was reordered');
  }],
  ['Help questions allow empty media and retain all supplied account fields', () => {
    const parsed = parseHelpMedia(sampleQuestion);
    assert(parsed.isQuestion && !parsed.warnings.length, 'Valid text-only question produced warnings');
    const { host, view } = helpViews(sampleQuestion);
    assert(
      host.querySelector('.chat-help-question-text').textContent === sampleQuestion.question
      && host.querySelectorAll('button').length === 2
      && !host.querySelector('.chat-tool-fallback,img,ol'),
      'Question was lost or empty media/instructions were treated as an error',
    );
    assert(
      host.querySelector('.chat-help-summary').textContent === sampleQuestion.account_check.summary
      && [...host.querySelectorAll('dd')].map((field) => field.textContent).join('|')
        === '9999|Active|DEMO-01|1 October 2026|7',
      'Account-check details were lost or changed',
    );
    view.dispose();
    [undefined, []].forEach((media) => {
      assert(
        !parseHelpMedia({
          status: 'question', question: 'Demo?', options: ['Yes'], ...(media ? { media } : {}),
        }).warnings.length,
        'Question required optional media, instructions or account details',
      );
    });
  }],
  ['Question answer buttons upsert, respect busy state and stop after replacement/disposal', () => {
    const host = document.createElement('div');
    const sent = [];
    const view = createToolViews(host, (answer) => sent.push(answer));
    const tools = new Map([['help:q', { kind: 'helpMedia', value: sampleQuestion }]]);
    view.update(tools);
    const yes = host.querySelector('button');
    view.update(tools);
    assert(host.querySelector('button') === yes, 'Question buttons duplicated');
    view.setBusy(true);
    yes.dispatchEvent(new Event('click'));
    assert(yes.disabled && !sent.length, 'Busy question submitted');
    view.setBusy(false);
    yes.click();
    assert(sent.join() === 'Yes' && yes.type === 'button', 'Answer text or button type changed');
    view.update(new Map([['help:q', {
      kind: 'helpMedia', value: { ...sampleQuestion, question: 'Next demo question?' },
    }]]));
    yes.dispatchEvent(new Event('click'));
    assert(sent.length === 1, 'Replaced question remained interactive');
    const next = host.querySelectorAll('button')[1];
    view.dispose();
    next.dispatchEvent(new Event('click'));
    assert(sent.length === 1, 'Disposed question submitted');
  }],
  ['Malformed help questions warn without hiding usable data or coercing counts', () => {
    const invalid = {
      ...sampleQuestion,
      question: null,
      options: ['Yes', null],
      account_check: { ...sampleQuestion.account_check, trips_matched_by_plate_since: '7' },
    };
    const { host, view } = helpViews(invalid);
    assert(
      host.querySelectorAll('.chat-tool-fallback').length === 3
      && host.querySelector('button').textContent === 'Yes'
      && host.querySelectorAll('dd').length === 4,
      'Malformed question fields were silently accepted or usable details lost',
    );
    view.dispose();
    assert(
      parseHelpMedia({ ...sampleQuestion, options: [], account_check: null }).warnings.length === 2,
      'Empty answers or invalid account data did not warn',
    );
    const zero = parseHelpMedia({
      ...sampleQuestion, account_check: { trips_matched_by_plate_since: 0 },
    });
    assert(zero.accountFields[0][1] === '0' && !zero.warnings.length, 'Zero count was lost');
    const unsafe = '<img src=x onerror=alert(1)>';
    const safe = helpViews({
      ...sampleQuestion, question: unsafe, options: [unsafe], account_check: { summary: unsafe },
    });
    assert(
      !safe.host.querySelector('img') && safe.host.querySelector('button').textContent === unsafe,
      'Question fields were interpreted as markup',
    );
    safe.view.dispose();
  }],
  ['Help guidance collapses only with completed answer and usable media, preserving every field', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const value = { ...sampleOutcome, steps: sampleHelp.steps, media: [sampleHelp.media[2]] };
    const original = JSON.stringify(value);
    const tools = new Map([['help:guidance', { kind: 'helpMedia', value }]]);
    view.update(tools, { hasAnswer: true, completed: false });
    const details = host.querySelector('.chat-help-details');
    assert(details.open, 'Streaming help hid its guidance');
    view.update(tools, { hasAnswer: false, completed: true });
    assert(details.open, 'Tool-only help hid its only explanation');
    view.update(tools, { hasAnswer: true, completed: true });
    assert(
      !details.open && host.querySelector('.chat-help-details') === details,
      'Completed help failed to collapse or recreated its content',
    );
    assert(
      details.querySelector('.chat-help-advice').textContent === sampleOutcome.advice
      && details.querySelectorAll('ol li').length === sampleHelp.steps.length
      && !details.querySelector('.chat-help-media,.chat-help-offer-item,.chat-help-question-text,.chat-tool-fallback')
      && host.querySelector('.chat-help-video-play')
      && host.querySelector('.chat-help-question-text').textContent === sampleOutcome.offer.prompt
      && JSON.stringify(value) === original,
      'Progressive disclosure lost/changed data or hid media and actions',
    );
    view.update(tools, { hasAnswer: true, completed: false });
    assert(details.open, 'Unsuccessful/incomplete help hid guidance');
    view.dispose();
  }],
  ['Manual guidance choices survive context changes and tool replacement without affecting other cards', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const value = { ...sampleOutcome, media: [sampleHelp.media[2]] };
    let tools = new Map([['help:guidance', { kind: 'helpMedia', value }]]);
    view.update(tools);
    const details = host.querySelector('details');
    const summary = details.querySelector('summary');
    summary.click();
    assert(!details.open, 'Summary did not close expanded guidance');
    view.update(tools, { hasAnswer: false, completed: false });
    assert(!details.open, 'Streaming update overrode manual close');
    summary.click();
    view.update(tools, { hasAnswer: true, completed: true });
    assert(details.open, 'Completion overrode manual open');
    tools = new Map([['help:guidance', {
      kind: 'helpMedia', value: { ...value, advice: 'Updated fictional advice.' },
    }]]);
    view.update(tools, { hasAnswer: true, completed: true });
    const replacement = host.querySelector('details');
    assert(replacement !== details && replacement.open, 'Tool replacement lost explicit choice');
    summary.click();
    view.update(tools, { hasAnswer: true, completed: true });
    assert(replacement.open, 'Disposed summary changed the replacement choice');
    tools.set('help:other', { kind: 'helpMedia', value });
    view.update(tools, { hasAnswer: true, completed: true });
    assert(!host.querySelectorAll('details')[1].open, 'Choice leaked to a different tool ID');
    const replacementSummary = replacement.querySelector('summary');
    view.dispose();
    replacementSummary.click();
    assert(!host.hasChildNodes(), 'Disposal retained guidance content');
  }],
  ['Missing, invalid and failed media leave help guidance readable with warnings outside', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const value = { ...sampleOutcome, media: [sampleOutcome.media[0]] };
    const tools = new Map([['help:image', { kind: 'helpMedia', value }]]);
    const completed = { hasAnswer: true, completed: true };
    view.update(tools, completed);
    const details = host.querySelector('details');
    const image = host.querySelector('img');
    assert(details.open, 'Pending image counted as usable media');
    image.dispatchEvent(new Event('load'));
    assert(!details.open, 'Loaded illustration did not enable progressive disclosure');
    image.dispatchEvent(new Event('error'));
    assert(details.open && host.querySelector('.chat-tool-fallback')
      && !details.querySelector('.chat-tool-fallback'), 'Image failure hid guidance or its warning');
    [[], [{ type: 'video', youtubeId: 'bad' }]].forEach((media) => {
      view.update(new Map([['help:image', {
        kind: 'helpMedia', value: { ...sampleOutcome, media },
      }]]), completed);
      assert(host.querySelector('details').open, 'Unavailable media collapsed guidance');
    });
    view.dispose();
  }],
  ['Question controls and malformed-data notices remain outside expandable guidance', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(new Map([['help:question', {
      kind: 'helpMedia',
      value: {
        ...sampleQuestion, steps: ['Demo instruction.', null], media: [sampleHelp.media[2]],
      },
    }]]), { hasAnswer: true, completed: true });
    const details = host.querySelector('details');
    assert(
      !details.open && host.querySelectorAll('.chat-help-options button').length === 2
      && host.querySelector('.chat-help-account-fields')
      && host.querySelector('.chat-tool-fallback')
      && details.querySelector('.chat-help-account')
      && !details.querySelector('.chat-help-options,.chat-tool-fallback'),
      'Disclosure hid a question, account check, answer controls or warning',
    );
    view.dispose();
  }],
  ['Account-check details collapse without media only after successful completion and retain user choices', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const tools = new Map([['help:account', { kind: 'helpMedia', value: sampleQuestion }]]);
    const original = JSON.stringify(sampleQuestion);
    view.update(tools, { hasAnswer: true, completed: false });
    const details = host.querySelector('details');
    assert(details.open, 'Streaming account check collapsed');
    view.update(tools, { hasAnswer: false, completed: true });
    assert(details.open, 'Tool-only account check collapsed');
    view.update(tools, { hasAnswer: true, completed: true });
    assert(
      !details.open && details.querySelector('strong').textContent === 'Account-check details'
      && details.querySelectorAll('dd').length === 5
      && details.querySelector('.chat-help-summary').textContent === sampleQuestion.account_check.summary
      && !details.querySelector('.chat-help-question-text,button')
      && host.querySelector('.chat-help-question-text').textContent === sampleQuestion.question,
      'Account disclosure lost fields, required media or hid the active question',
    );
    details.querySelector('summary').click();
    view.update(tools, { hasAnswer: true, completed: true });
    assert(details.open, 'Account expansion was not preserved');
    details.querySelector('summary').click();
    view.update(tools, { hasAnswer: true, completed: false });
    assert(!details.open, 'Manual close was not preserved');
    assert(JSON.stringify(sampleQuestion) === original, 'Account data mutated');
    view.dispose();
    assert(!host.hasChildNodes(), 'Account disclosure survived disposal');
  }],
  ['Help outcomes render advice, offer and illustrations without instruction warnings', () => {
    const parsed = parseHelpMedia(sampleOutcome);
    assert(parsed.isOutcome && !parsed.warnings.length, 'Valid outcome produced false warnings');
    const { host, view } = helpViews(sampleOutcome, new URL('../../help/tags/', import.meta.url).href);
    assert(
      host.querySelector('.chat-help-advice').textContent === sampleOutcome.advice
      && host.querySelector('.chat-help-question-text').textContent === sampleOutcome.offer.prompt
      && host.querySelector('.chat-help-offer-item').textContent.includes('holder')
      && host.querySelectorAll('img').length === 2
      && !host.querySelector('.chat-tool-fallback,button,ol'),
      'Outcome lost data, hid illustrations, warned or fabricated an action button',
    );
    view.dispose();
    const { media, offer, ...textOnly } = sampleOutcome;
    assert(!parseHelpMedia(textOnly).warnings.length, 'Outcome required optional media or offer');
    assert(!parseHelpMedia({ ...textOnly, media: [] }).warnings.length, 'Empty outcome media warned');
  }],
  ['Video-only outcomes accept null offers without warnings or missing-image fallbacks', () => {
    const value = {
      status: 'outcome',
      outcome: 'working',
      advice: 'Fictional tag-check advice.',
      offer: null,
      media: [{ type: 'video', youtubeId: 'OvsDIBF1emE', title: 'What do the tag beeps mean?' }],
    };
    const parsed = parseHelpMedia(value);
    assert(parsed.offer === null && !parsed.warnings.length, 'Null offer produced a warning');
    const { host, view } = helpViews(value);
    assert(
      host.querySelector('.chat-help-video-link')?.href === 'https://www.youtube.com/watch?v=OvsDIBF1emE'
      && !host.querySelector('.chat-tool-fallback,img,iframe,.chat-help-offer-item')
      && host.querySelector('.chat-help-advice').textContent === value.advice,
      'Video-only outcome lost its link/advice, warned, or created an image/player/offer',
    );
    view.dispose();
    [false, 0, '', [], {}].forEach((offer) => {
      assert(parseHelpMedia({ ...value, offer }).warnings.length > 0, 'Malformed non-null offer was accepted');
    });
  }],
  ['Malformed outcome fields warn and remain plain text without enabling actions', () => {
    const parsed = parseHelpMedia({
      status: 'outcome', outcome: null, advice: 7, offer: { item: 'holder' }, media: null,
    });
    assert(
      parsed.warnings.length === 4 && parsed.offer.item === 'holder',
      'Invalid outcome fields were silently accepted or usable offer data lost',
    );
    const unsafe = '<img src=x onerror=alert(1)>';
    const { host, view } = helpViews({
      ...sampleOutcome,
      outcome: unsafe,
      advice: unsafe,
      offer: { action: unsafe, item: unsafe, prompt: unsafe },
      media: [],
    });
    assert(
      !host.querySelector('img,a,button')
      && host.querySelector('.chat-help-advice').textContent === unsafe
      && host.querySelector('.chat-help-question-text').textContent === unsafe,
      'Outcome interpreted plain text as markup or executed an offer',
    );
    view.dispose();
  }],
  ['Only boolean found:true enables help media; valid instructions remain', () => {
    [false, 'false', 'true', undefined, null, 1].forEach((found) => {
      const { host, view } = helpViews({ ...sampleHelp, found }, helpBase);
      assert(host.querySelectorAll('ol li').length === 2, 'Valid instructions disappeared');
      assert(!host.querySelector('img,a'), 'Unsuccessful help loaded media');
      assert(host.querySelector('.chat-tool-fallback'), 'Unavailable help had no notice');
      view.dispose();
    });
  }],
  ['Missing fields and malformed help steps produce explicit fallbacks', () => {
    const help = parseHelpMedia({ found: true, steps: ['Valid instruction', null, 42] });
    assert(help.title === 'Help instructions' && help.steps.length === 1, 'Help validation failed');
    assert(help.warnings.length === 2, 'Invalid steps or missing media were silently ignored');
    assert(parseHelpMedia(null).warnings.length > 0, 'Missing help had no fallback');
  }],
  ['Help image URLs resolve only within a configured HTTPS origin and directory', () => {
    ['mini.svg', '/help/tags/mini.svg', `${helpBase}mini.svg`].forEach((src) => {
      const result = resolveHelpMediaURL({ type: 'image', src }, helpBase);
      assert(result.url === `${helpBase}mini.svg`, 'Confirmed asset URL resolved incorrectly');
    });
    const root = resolveHelpMediaURL(
      { type: 'image', src: 'mini.svg' },
      'https://assets.example.invalid',
    );
    assert(root.url === `${helpBase}mini.svg`, 'Origin-only configuration lost the approved tag path');
  }],
  ['Explicitly empty asset configuration never guesses a host, even for absolute URLs', () => {
    [sampleHelp.media[0], { type: 'image', src: `${helpBase}mini.svg` }].forEach((entry) => {
      const result = resolveHelpMediaURL(entry, '');
      assert(result.error?.includes('not been configured') && !result.url, 'Asset host was guessed');
    });
  }],
  ['HTTP help images are restricted to same-origin loopback development', () => {
    const base = new URL('/help/tags/', import.meta.url);
    assert(resolveHelpMediaURL(sampleHelp.media[0], base.href).url, 'Local asset was rejected');
    const otherPort = new URL(base);
    otherPort.protocol = 'http:';
    otherPort.port = base.port === '3199' ? '3198' : '3199';
    const remote = 'http://assets.example.invalid/help/tags/';
    [otherPort.href, remote].forEach((untrusted) => {
      assert(resolveHelpMediaURL(sampleHelp.media[0], untrusted).error, 'Untrusted HTTP base loaded');
    });
    ['/help/private.svg', 'http://unapproved.invalid/help/tags/mini.svg'].forEach((src) => {
      assert(resolveHelpMediaURL({ type: 'image', src }, base.href).error, 'Local policy escaped');
    });
  }],
  ['All six bundled help illustrations load with the default asset base', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = createToolViews(host, () => {});
    try {
      view.update(new Map([['helpMedia:bundled', {
        kind: 'helpMedia', value: bundledHelp,
      }]]));
      const images = [...host.querySelectorAll('img')];
      assert(images.length === 6, 'Default configuration did not create six illustrations');
      images.forEach((image) => {
        image.loading = 'eager';
        assert(
          new URL(image.src).origin === new URL(import.meta.url).origin,
          'Image left the local asset origin',
        );
      });
      await waitFor(
        () => images.every((image) => image.complete && image.naturalWidth > 0),
        'all six bundled illustrations',
      );
      assert(!host.querySelector('.chat-tool-fallback'), 'Bundled image fell back unexpectedly');
    } finally {
      view.dispose();
      host.remove();
    }
  }],
  ['Unsafe image schemes, origins, credentials and asset-path escapes are rejected', () => {
    // eslint-disable-next-line no-script-url -- Intentional invalid URL fixtures.
    const sources = ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///tmp/a.svg',
      'blob:https://assets.example.invalid/id', 'http://assets.example.invalid/help/tags/a.svg',
      '//assets.example.invalid/help/tags/a.svg', 'https://unapproved.invalid/help/tags/a.svg',
      'https://user:password@assets.example.invalid/help/tags/a.svg',
      'https://assets.example.invalid.evil.invalid/help/tags/a.svg',
      '/help/tags-evil/a.svg', '/help/tags/../private.svg', '../private.svg',
      '/help/tags/%2e%2e/private.svg', '/help/tags/%252e%252e/private.svg',
      '/help/tags/a%2f..%2fprivate.svg', '/help/tags/a\\..\\private.svg',
      '/help/tags/a.svg?token=fixture', '/help/tags/a.svg#fragment', '/help/tags/%ZZ.svg'];
    sources.forEach((src) => {
      const result = resolveHelpMediaURL({ type: 'image', src }, helpBase);
      assert(result.error && !result.url, `Unsafe help image was accepted: ${src}`);
    });
  }],
  ['Invalid or credential-bearing asset configuration is rejected', () => {
    ['http://assets.example.invalid/help/tags/', '//assets.example.invalid/help/tags/',
      'https://user:password@assets.example.invalid/help/tags/',
      `${helpBase}?key=fixture`, `${helpBase}#fragment`,
      'https://assets.example.invalid/help/tags'].forEach((base) => {
      assert(resolveHelpMediaURL(sampleHelp.media[0], base).error, 'Invalid asset base was accepted');
    });
  }],
  ['Only validated YouTube IDs create trusted video URLs', () => {
    const result = resolveHelpMediaURL(sampleHelp.media[2], '');
    assert(result.url === 'https://www.youtube.com/watch?v=7sT7hg396EQ', 'Unexpected video origin or URL');
    [null, 42, '', 'short', '../7sT7hg396EQ', '7sT7hg396EQ\n',
      '7sT7hg396EQ?x=1', 'https://evil.invalid'].forEach((youtubeId) => {
      assert(resolveHelpMediaURL({ type: 'video', youtubeId }).error, 'Invalid video ID was accepted');
    });
    assert(
      resolveHelpMediaURL({ type: 'video', src: 'https://evil.invalid/embed' }).error,
      'Arbitrary video URL was accepted',
    );
  }],
  ['Unknown and malformed media entries do not become HTML or throw', () => {
    [null, {}, { type: 'iframe', src: 'https://evil.invalid' }, { type: 'image', src: 42 }]
      .forEach((entry) => assert(resolveHelpMediaURL(entry, helpBase).error, 'Bad media was accepted'));
  }],
  ['Unconfigured help cards retain instructions, captions and a safe video link', () => {
    const { host, view } = helpViews(sampleHelp);
    assert(host.querySelector('h3').textContent === 'Installing your tag', 'Help title changed');
    assert(host.querySelectorAll('ol li').length === 2, 'Ordered steps were lost');
    assert(
      !host.querySelector('img') && host.querySelectorAll('figcaption').length === 2,
      'Unconfigured illustrations were fetched or their captions were lost',
    );
    assert(host.querySelectorAll('figure').length === 3, 'Media ordering was not preserved');
    assert(
      host.querySelector('.chat-tool-fallback').textContent.includes('Mini tag illustration'),
      'Unavailable illustration lost its accessible description',
    );
    const video = host.querySelector('.chat-help-video-link');
    assert(video.target === '_blank' && video.rel.includes('noopener'), 'Unsafe external link');
    assert(video.textContent.includes('Tag installation video'), 'Video title was lost');
    assert(
      host.querySelector('.chat-help-video-note').textContent.includes('not been verified'),
      'Video availability was assumed',
    );
    view.dispose();
  }],
  ['Video cards require their own Play action before loading embeds or thumbnails', () => {
    const { host, view } = helpViews(sampleHelp);
    [false, true].forEach((consented) => {
      window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
      assert(!host.querySelector('iframe,video,img'), 'Third-party media loaded before Play');
    });
    assert(
      host.querySelector('.chat-help-video-play')?.getAttribute('aria-label')
        === 'Play video: Tag installation video'
      && host.querySelector('.chat-help-video-title')?.textContent === 'Tag installation video',
      'Visible video card lost its accessible play control or title',
    );
    view.dispose();
  }],
  ['Video players load only on Play, upsert stably, and stop on replacement/disposal', () => {
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    const value = { ...sampleHelp, media: [sampleHelp.media[2]] };
    const tools = new Map([['help:video', { kind: 'helpMedia', value }]]);
    view.setBusy(true);
    view.update(tools);
    const play = host.querySelector('.chat-help-video-play');
    assert(play.disabled && play.type === 'button', 'New busy video card was interactive or submitted a form');
    play.dispatchEvent(new Event('click'));
    assert(!host.querySelector('iframe'), 'Busy card loaded a player');
    view.setBusy(false);
    play.click();
    const player = host.querySelector('iframe');
    assert(
      player?.src === 'https://www.youtube-nocookie.com/embed/7sT7hg396EQ?autoplay=1'
      && player.title === 'Tag installation video'
      && player.referrerPolicy === 'strict-origin-when-cross-origin'
      && player.allowFullscreen && player.allow.includes('autoplay'),
      'Play did not create the trusted accessible inline player',
    );
    assert(host.querySelector('.chat-help-video-link'), 'Player lost its external fallback link');
    view.update(tools);
    assert(host.querySelector('iframe') === player, 'Identical update restarted the player');
    view.update(new Map([['help:video', {
      kind: 'helpMedia', value: { ...value, title: 'Updated help' },
    }]]));
    assert(!player.hasAttribute('src') && !host.querySelector('iframe'), 'Replacement retained the old player');
    play.dispatchEvent(new Event('click'));
    assert(!host.querySelector('iframe'), 'Replaced play control remained interactive');
    const nextPlay = host.querySelector('.chat-help-video-play');
    nextPlay.click();
    const nextPlayer = host.querySelector('iframe');
    view.dispose();
    assert(!nextPlayer.hasAttribute('src') && !host.hasChildNodes(), 'Disposal retained the player or source');
    nextPlay.dispatchEvent(new Event('click'));
    assert(!host.querySelector('iframe'), 'Disposed card loaded a player');
  }],
  ['Video load failures keep a visible explanation and YouTube fallback', () => {
    const { host, view } = helpViews({ ...sampleHelp, media: [sampleHelp.media[2]] });
    host.querySelector('.chat-help-video-play').click();
    host.querySelector('iframe').dispatchEvent(new Event('error'));
    assert(
      !host.querySelector('iframe')
      && host.querySelector('.chat-help-video-note').textContent.includes('could not be loaded')
      && host.querySelector('.chat-help-video-link').href === 'https://www.youtube.com/watch?v=7sT7hg396EQ',
      'Player failure was hidden or removed its fallback',
    );
    view.dispose();
  }],
  ['Configured help images preserve alt/captions, lazy loading and reserved space', () => {
    const { host, view } = helpViews(sampleHelp, helpBase);
    const image = host.querySelector('img');
    assert(image.alt === 'Mini tag illustration', 'Image alt text changed');
    assert(image.loading === 'lazy' && image.decoding === 'async', 'Lazy conventions changed');
    assert(image.width === 640 && image.height === 360, 'Layout space was not reserved');
    assert(image.crossOrigin === 'anonymous', 'Third-party image credentials were not disabled');
    assert(image.referrerPolicy === 'no-referrer', 'Image referrer policy changed');
    assert(!image.src.includes('token') && !image.src.includes('key='), 'Credentials were added');
    view.dispose();
    assert(!image.hasAttribute('src'), 'Disposed image kept its source');
  }],
  ['Missing image alt text uses plain captions or a generic accessible fallback', () => {
    const { host, view } = helpViews({
      ...sampleHelp,
      media: [
        { type: 'image', src: 'a.svg', caption: 'Caption fallback' },
        { type: 'image', src: 'b.svg', caption: { unexpected: true } },
      ],
    }, helpBase);
    const images = host.querySelectorAll('img');
    assert(
      images[0].alt === 'Caption fallback' && images[1].alt === 'Help illustration',
      'Missing alt text became inaccessible or an object string',
    );
    view.dispose();
  }],
  ['Broken help images keep valid instructions and do not enter retry loops', () => {
    const { host, view } = helpViews(sampleHelp, helpBase);
    const image = host.querySelector('img');
    image.dispatchEvent(new Event('error'));
    const count = host.querySelectorAll('.chat-tool-fallback').length;
    image.dispatchEvent(new Event('error'));
    assert(
      count === 1 && host.querySelectorAll('.chat-tool-fallback').length === 1,
      'Image errors repeated',
    );
    assert(host.querySelectorAll('ol li').length === 2, 'Image failure removed instructions');
    view.dispose();
  }],
  ['Help labels, captions and steps are plain text, not raw HTML', () => {
    const dangerous = '<img src=x onerror=alert(1)>';
    const { host, view } = helpViews({
      found: true,
      title: dangerous,
      steps: [dangerous],
      media: [{ type: 'image', src: 'a.svg', caption: dangerous },
        { type: 'video', youtubeId: '7sT7hg396EQ', title: dangerous }],
    });
    assert(host.querySelector('h3').textContent === dangerous, 'Title was not preserved as text');
    assert(!host.querySelector('img,script,iframe,[onerror]'), 'Help content was executed as HTML');
    view.dispose();
  }],
  ['Malformed help-media entries leave valid instructions usable', () => {
    const { host, view } = helpViews({
      ...sampleHelp, media: [null, { type: 'unknown' }, { type: 'video', youtubeId: 'bad' }],
    });
    assert(host.querySelectorAll('ol li').length === 2, 'Malformed media removed instructions');
    assert(host.querySelectorAll('.chat-tool-fallback').length === 3, 'Bad media lacked fallbacks');
    view.dispose();
  }],
  ['Help data is collected from status, artifact, message and task snapshot parts', () => {
    [status([tool('helpMedia', sampleHelp)]),
      { kind: 'artifact-update', artifact: { artifactId: 'a', parts: [tool('helpMedia', sampleHelp)] } },
      { kind: 'message', parts: [tool('helpMedia', sampleHelp)] },
      { kind: 'task', artifacts: [{ artifactId: 'a', parts: [tool('helpMedia', sampleHelp)] }] }]
      .forEach((event) => {
        const state = createTurnState('c');
        apply(state, event);
        assert(state.tools.get('helpMedia:tool-1')?.value === sampleHelp, 'Help part was discarded');
      });
  }],
  ['Repeated, updated and distinct help calls upsert within their own turn', () => {
    const state = createTurnState('c');
    const host = document.createElement('div');
    const view = createToolViews(host, () => {}, '');
    apply(state, status([tool('helpMedia', sampleHelp)]));
    view.update(state.tools);
    const first = host.firstElementChild;
    apply(state, status([tool('helpMedia', JSON.parse(JSON.stringify(sampleHelp)))]));
    apply(state, { kind: 'artifact-update', artifact: { artifactId: 'a', parts: [text('Final answer')] } });
    view.update(state.tools);
    assert(
      host.firstElementChild === first && host.querySelectorAll('.chat-help').length === 1,
      'Repeated help was recreated or duplicated',
    );
    apply(state, status([tool('helpMedia', { ...sampleHelp, title: 'Updated title' })]));
    view.update(state.tools);
    assert(host.querySelector('h3').textContent === 'Updated title', 'Help update was lost');
    apply(state, status([tool('helpMedia', sampleHelp, 'second-call')]));
    view.update(state.tools);
    assert(host.querySelectorAll('.chat-help').length === 2, 'Distinct tool calls overwrote each other');
    assert(answerParts(state)[0].text === 'Final answer', 'Help updates replaced the final answer');
    view.dispose();
    view.update(state.tools);
    assert(!host.hasChildNodes(), 'Late help update recreated a disposed turn');
    assert(createTurnState('other').tools.size === 0, 'Help leaked into another conversation');
  }],
  ['Mentions of pictures, videos and maps without structured data fabricate nothing', () => {
    const state = createTurnState('c');
    apply(state, { kind: 'message', parts: [text('Here are installation pictures, a video and a map.')] });
    const host = document.createElement('div');
    const view = createToolViews(host, () => {});
    view.update(state.tools);
    assert(!host.hasChildNodes() && state.tools.size === 0, 'Media was inferred from answer wording');
    view.dispose();
  }],
  ['Chat scales on large screens and stays centred through desktop/mobile resizing', async () => {
    const frame = document.createElement('iframe');
    frame.title = 'Isolated chat layout regression';
    frame.style.cssText = 'position:fixed;top:0;left:0;border:0;visibility:hidden;width:1920px;height:1080px';
    frame.src = '/';
    document.body.append(frame);
    try {
      await waitFor(() => frame.contentDocument?.querySelector('.chat-field'), 'chat layout initialisation');
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      await waitFor(() => !doc.querySelector('.chat-launcher-trigger').disabled, 'layout sign-in ready');
      doc.querySelector('.chat-launcher-trigger').click();
      await waitFor(() => !doc.querySelector('.chat-field').disabled, 'layout authenticated session');
      doc.querySelector('.chat-launcher-trigger').click();
      doc.getAnimations().filter((animation) => Number.isFinite(animation.effect
        .getComputedTiming().endTime)).forEach((animation) => animation.finish());
      const sizes = [
        [1920, 1080, 1600, 984, 18],
        [2560, 1440, 1600, 1200, 18],
        [1366, 768, 1238, 672, 18],
        [1024, 768, 960, 656, 16],
        [390, 844, 390, 844, 16],
        [1920, 1080, 1600, 984, 18],
      ];
      // eslint-disable-next-line no-restricted-syntax -- Sequential sizes exercise one open dialog.
      for (const [width, height, expectedWidth, expectedHeight, fontSize] of sizes) {
        frame.style.width = `${width}px`;
        frame.style.height = `${height}px`;
        win.dispatchEvent(new win.Event('resize'));
        const dialog = doc.querySelector('.chat-dialog');
        // eslint-disable-next-line no-await-in-loop
        await waitFor(() => {
          const bounds = dialog.getBoundingClientRect();
          return Math.abs(bounds.width - expectedWidth) < 1
            && Math.abs(bounds.height - expectedHeight) < 1;
        }, `dialog sizing at ${width}x${height}`);
        const bounds = dialog.getBoundingClientRect();
        assert(Math.abs(bounds.left - (width - expectedWidth) / 2) < 1, 'Dialog lost horizontal centre');
        assert(Math.abs(bounds.top - (height - expectedHeight) / 2) < 1, 'Dialog lost vertical centre');
        assert(dialog.scrollWidth <= dialog.clientWidth, 'Dialog has horizontal overflow');
        const field = doc.querySelector('.chat-field');
        assert(parseFloat(win.getComputedStyle(field).fontSize) === fontSize, 'Composer font did not scale');
        assert(field.getBoundingClientRect().bottom <= bounds.bottom, 'Composer fell outside the dialog');
      }
    } finally {
      frame.remove();
    }
  }],
  ['Full chat flow preserves auth/context, blocks duplicates, and handles HTTP/SSE failures', async () => {
    const frame = document.createElement('iframe');
    frame.title = 'Isolated local chat regression';
    frame.style.cssText = 'position:fixed;top:0;left:0;border:0;visibility:hidden;width:1280px;height:900px';
    frame.src = '/';
    document.body.append(frame);
    try {
      await waitFor(() => frame.contentDocument?.querySelector('.chat-field'), 'chat initialisation');
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const resizeObservers = new Map();
      win.ResizeObserver = class extends win.ResizeObserver {
        constructor(callback) {
          super(callback);
          resizeObservers.set(this, callback);
        }

        disconnect() {
          resizeObservers.delete(this);
          super.disconnect();
        }
      };
      Object.defineProperty(doc, 'cookie', {
        configurable: true,
        get() { throw new Error('Chat must not read cookies'); },
      });
      const originalFetch = win.fetch.bind(win);
      const requests = [];
      let mode = 'structured';
      let unauthorized = true;
      let cancelled = false;
      let rejectedBodyCancelled = false;
      let progressController;
      win.fetch = (url, options) => {
        if (url !== '/__mock/ag-ui') return originalFetch(url, options);
        const request = JSON.parse(options.body);
        requests.push({
          request,
          token: options.headers.Authorization,
          session: options.headers['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'],
          credentials: options.credentials,
        });
        if (mode === 'progress-held') {
          return Promise.resolve(new win.Response(new win.ReadableStream({
            start(controller) {
              progressController = controller;
              const event = { type: 'TOOL_CALL_START', toolCallId: 'p', toolCallName: 'synthetic_tool' };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
            },
          }), { headers: { 'Content-Type': 'text/event-stream' } }));
        }
        if (mode === 'held') {
          return Promise.resolve(new win.Response(new win.ReadableStream({
            start(controller) {
              const event = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'held', delta: 'Held partial answer' };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
              options.signal.addEventListener('abort', () => {
                cancelled = true;
                controller.error(new win.DOMException('Cancelled fixture', 'AbortError'));
              }, { once: true });
            },
          }), { headers: { 'Content-Type': 'text/event-stream' } }));
        }
        if (mode === 'auth-retry' && unauthorized) {
          unauthorized = false;
          return Promise.resolve(new win.Response('{}', { status: 401 }));
        }
        if (mode === 'empty-response') {
          return Promise.resolve(new win.Response(null, { status: 204 }));
        }
        if (mode === 'http-error' || mode === 'json-response') {
          const response = new win.Response('{"error":"fixture"}', {
            status: mode === 'http-error' ? 500 : 200,
            headers: { 'Content-Type': 'application/json' },
          });
          const cancel = response.body.cancel.bind(response.body);
          response.body.cancel = () => {
            rejectedBodyCancelled = true;
            return cancel();
          };
          return Promise.resolve(response);
        }
        // Arbitrary CUSTOM names remain unsupported even when their values resemble known tools.
        let events = mode === 'structured' ? [
          { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Final answer' },
          { type: 'CUSTOM', name: 'synthetic-unmapped', value: { sampleHelp } },
          { type: 'CUSTOM', name: 'synthetic-unmapped', value: { sampleRoute } },
          { type: 'RUN_FINISHED' },
        ] : [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Partial answer' }];
        if (mode === 'route') {
          const routeEvent = {
            type: 'CUSTOM', name: 'routePlan', value: { ...sampleRoute, toolCallId: 'aws-route' },
          };
          events = [
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Final route answer' },
            routeEvent,
            routeEvent,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-route' },
            { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'aws-followups', options: ['Check a different route', 'Plan another trip'] } },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'statement') {
          const card = {
            type: 'CUSTOM', name: 'statementCard', value: { ...sampleStatement, toolCallId: 'aws-statement' },
          };
          events = [
            { type: 'TOOL_CALL_START', toolCallId: 'aws-statement', toolCallName: 'get_statement_details' },
            card,
            card,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-statement' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Your fictional statement is ready.' },
            { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'statement-followups', options: ['Why were trips matched by plate?', 'Check my recent trips', 'Explain a specific trip'] } },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'trip-list') {
          const tripEvent = {
            type: 'CUSTOM', name: 'tripList', value: { toolCallId: 'aws-trips', trips: sampleTrips },
          };
          events = [
            { type: 'TOOL_CALL_START', toolCallId: 'aws-trips', toolCallName: 'get_my_trips' },
            tripEvent,
            tripEvent,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-trips' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Here are your fictional trips.' },
            { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'trip-followups', options: ['Check my tag', 'Order a replacement', 'Dispute the video matching fees'] } },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'help-media') {
          const helpEvent = {
            type: 'CUSTOM', name: 'helpMedia', value: { ...bundledHelp, toolCallId: 'aws-help' },
          };
          events = [
            { type: 'TOOL_CALL_START', toolCallId: 'aws-help', toolCallName: 'tag_how_to' },
            helpEvent,
            helpEvent,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-help' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Your demo tag instructions.' },
            { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'help-followups', options: ['Check my tag', "Tag isn't beeping", 'Metallic windscreen'] } },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'help-question') {
          const questionEvent = {
            type: 'CUSTOM', name: 'helpMedia', value: { ...sampleQuestion, toolCallId: 'aws-question' },
          };
          events = [
            { type: 'TOOL_CALL_START', toolCallId: 'aws-question', toolCallName: 'tag_health_check' },
            questionEvent,
            questionEvent,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-question' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Let us check your fictional tag.' },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'help-outcome') {
          const outcomeEvent = {
            type: 'CUSTOM', name: 'helpMedia', value: { ...sampleOutcome, toolCallId: 'aws-outcome' },
          };
          events = [
            { type: 'TOOL_CALL_START', toolCallId: 'aws-outcome', toolCallName: 'tag_health_check' },
            outcomeEvent,
            outcomeEvent,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-outcome' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Your fictional tag-check result.' },
            { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'outcome-followups', options: ['Yes, order it', 'No thanks'] } },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'trip-unavailable') {
          const card = {
            type: 'CUSTOM', name: 'tripCard', value: { toolCallId: 'aws-trip-missing', found: false },
          };
          events = [
            { type: 'TOOL_CALL_START', toolCallId: 'aws-trip-missing', toolCallName: 'explain_trip' },
            card,
            card,
            { type: 'TOOL_CALL_END', toolCallId: 'aws-trip-missing' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'Looking for your demo trip.' },
            { type: 'CUSTOM', name: 'tripList', value: { toolCallId: 'aws-empty-trips', trips: [] } },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'b', delta: 'Demo trip unavailable.' },
            { type: 'TOOL_CALL_START', toolCallId: 'aws-dispute', toolCallName: 'handle_dispute' },
            { type: 'TOOL_CALL_END', toolCallId: 'aws-dispute' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: 'c', delta: 'Existing fictional dispute DEMO-CASE.' },
            { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'dispute-followups', options: ['Check my dispute status', 'Dispute another trip', 'Back to my statement'] } },
            { type: 'RUN_FINISHED', threadId: request.threadId, runId: request.runId },
          ];
        }
        if (mode === 'rpc-error') events.push({ type: 'RUN_ERROR', message: 'Synthetic agent failure 401 is not an HTTP status' });
        if (['complete', 'auth-retry'].includes(mode)) events.push({ type: 'RUN_FINISHED' });
        if (mode === 'interrupted') {
          events.push({ type: 'TOOL_CALL_START', toolCallId: 'pending', toolCallName: 'synthetic_tool' });
        }
        return Promise.resolve(new win.Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ));
      };
      await waitFor(() => !doc.querySelector('.chat-launcher-trigger').disabled, 'local mock sign-in');
      await waitFor(
        () => doc.querySelector('.nav-auth-button')?.textContent === 'Log in',
        'header signed-out state',
      );
      assert(
        doc.querySelector('.chat-launcher-trigger span').textContent === 'Log in to chat',
        'Signed-out launcher did not offer login',
      );
      doc.querySelector('.chat-launcher button:not(.chat-launcher-trigger)').click();
      await waitFor(() => !doc.querySelector('.chat-field').disabled, 'synthetic authenticated UI');
      await waitFor(
        () => doc.querySelector('.nav-auth-button')?.textContent === 'Log out',
        'header authenticated state',
      );
      assert(!doc.querySelector('.chat-dialog').open, 'Signed-out launcher opened chat instead of login');
      assert(!doc.querySelector('.chat-auth button'), 'Dialog retained authentication controls');
      assert(
        [...doc.querySelectorAll('.chat-dialog button')]
          .every((button) => !/^(log|sign)\s*(in|out)$/i.test(button.textContent.trim())),
        'Dialog retained a login or logout button',
      );
      doc.querySelector('.chat-launcher-trigger').click();
      assert(doc.querySelector('.chat-auth').hidden, 'Authenticated dialog retained the auth bar');
      const submit = async (question) => {
        doc.querySelector('.chat-field').value = question;
        doc.querySelector('.chat-input').requestSubmit();
        await waitFor(() => doc.querySelector('.chat-messages')
          .getAttribute('aria-busy') === 'false', 'chat response');
      };
      await submit('Fixture question');
      assert(doc.querySelector('.chat-answer').textContent.trim() === 'Final answer', 'Answer duplicated');
      assert(!doc.querySelector('.chat-help,.chat-route,.chat-followup'), 'Unverified media was fabricated');
      assert(doc.querySelectorAll('.chat-turn-status:not([hidden])').length === 1, 'CUSTOM notice duplicated');
      assert(doc.querySelector('.chat-turn-status').textContent.includes('not yet supported'), 'CUSTOM limitation hidden');
      const oldTurn = doc.querySelector('.chat-message-received');
      mode = 'complete';
      doc.querySelector('.chat-field').value = 'Ask again';
      doc.querySelector('.chat-input').requestSubmit();
      doc.querySelector('.chat-input').requestSubmit();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'follow-up response');
      assert(requests.length === 2, 'Follow-up submitted twice');
      const [first, second] = requests.map((entry) => entry.request);
      assert(first.threadId === second.threadId, 'Thread changed');
      assert(requests[0].session === requests[1].session, 'Runtime session changed');
      assert(second.messages[0].content === 'Ask again', 'Question text changed');
      assert(first.runId !== second.runId, 'Run ID was reused');
      assert(requests.every((entry) => entry.token === 'Bearer synthetic-local-access-token'
        && entry.credentials === 'omit'), 'Mock bearer isolation failed');
      doc.querySelector('.chat-reset').click();
      assert(!oldTurn.isConnected, 'Old turn leaked into the new conversation');
      await submit('New conversation');
      assert(
        requests[2].request.threadId !== first.threadId
          && requests[2].session !== requests[0].session,
        'Reset reused the old conversation/session',
      );
      mode = 'auth-retry';
      await submit('Retry an HTTP authorization rejection');
      assert(
        requests.length === 5
        && JSON.stringify(requests[3].request) === JSON.stringify(requests[4].request),
        '401 retry changed the run/message or retried more than once',
      );
      const failureModes = ['http-error', 'json-response', 'empty-response', 'interrupted', 'rpc-error'];
      // eslint-disable-next-line no-restricted-syntax -- Sequential UI turns share one iframe.
      for (const failureMode of failureModes) {
        const before = requests.length;
        rejectedBodyCancelled = false;
        mode = failureMode;
        doc.querySelector('.chat-reset').click();
        // eslint-disable-next-line no-await-in-loop
        await submit(failureMode);
        assert(doc.querySelector('.chat-retry'), 'Failure did not offer retry');
        assert(requests.length === before + 1, 'Failed/partial stream was automatically replayed');
        if (['http-error', 'json-response'].includes(mode)) {
          assert(rejectedBodyCancelled, 'Rejected response body was not cancelled');
        }
        if (mode === 'empty-response') {
          assert(doc.querySelector('.chat-error-description').textContent
            .includes('no response stream'), 'Missing response stream had a misleading HTTP error');
        }
        if (['interrupted', 'rpc-error'].includes(mode)) {
          assert(
            doc.querySelector('.chat-answer').textContent.trim() === 'Partial answer',
            'Failure discarded partial content',
          );
          assert(
            doc.querySelector('.chat-error strong').textContent === 'Response interrupted',
            'Interrupted response was presented as success',
          );
        }
      }
      mode = 'progress-held';
      doc.querySelector('.chat-reset').click();
      doc.querySelector('.chat-field').value = 'Finish tool progress before text';
      doc.querySelector('.chat-input').requestSubmit();
      await waitFor(() => doc.querySelector('.chat-turn-status')?.textContent
        .includes('synthetic_tool'), 'tool progress');
      progressController.enqueue(new TextEncoder().encode(
        'data: {"type":"TOOL_CALL_END","toolCallId":"p"}\n\n',
      ));
      await waitFor(
        () => doc.querySelector('.chat-loading-status')
        && doc.querySelector('.chat-messages').getAttribute('aria-busy') === 'true',
        'loading indicator after tool completion',
      );
      progressController.enqueue(new TextEncoder().encode(
        'data: {"type":"RUN_ERROR","message":"Synthetic failure after progress"}\n\n',
      ));
      progressController.close();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'progress failure');
      assert(!doc.querySelector('.chat-turn-status:not([hidden])'), 'Failed tool progress stayed visible');
      assert(!doc.querySelector('.chat-loading-status'), 'Failure retained a loading indicator');
      mode = 'help-media';
      doc.querySelector('.chat-reset').click();
      await submit('Show demo tag installation help');
      const help = doc.querySelector('.chat-help');
      assert(
        help && doc.querySelectorAll('.chat-help').length === 1
        && !doc.querySelector('.chat-turn-status:not([hidden])'),
        'Help media was missing, duplicated or showed an unsupported notice',
      );
      assert(
        [...help.querySelectorAll('.chat-help-steps li')]
          .every((step, index) => step.textContent === bundledHelp.steps[index])
        && help.querySelectorAll('.chat-help-steps li').length === bundledHelp.steps.length
        && help.closest('.chat-message-received').textContent.includes('Your demo tag instructions.'),
        'Help instructions or assistant text were lost',
      );
      const helpImages = [...help.querySelectorAll('.chat-help-illustration')];
      helpImages.forEach((image) => { image.loading = 'eager'; });
      await waitFor(
        () => helpImages.length === 6
          && helpImages.every((image) => image.complete && image.naturalWidth > 0),
        'six AG-UI help illustrations',
      );
      assert(
        helpImages.every((image, index) => new URL(image.src).pathname
          === bundledHelp.media[index].src && image.alt === bundledHelp.media[index].alt)
        && [...help.querySelectorAll('figcaption')]
          .every((caption, index) => caption.textContent === bundledHelp.media[index].caption)
        && !help.querySelector('.chat-tool-fallback'),
        'Help illustrations lost their order, alt text, captions or asset location',
      );
      assert(
        help.querySelector('.chat-help-video-link')?.href === 'https://www.youtube.com/watch?v=7sT7hg396EQ'
        && !help.querySelector('iframe') && doc.querySelectorAll('.chat-followup').length === 3,
        'Help video or follow-ups were missing, or a player loaded before Play',
      );
      const helpGuidance = help.querySelector('.chat-help-details');
      assert(
        !helpGuidance.open && !helpGuidance.querySelector('.chat-help-media')
        && helpGuidance.querySelectorAll('ol li').length === bundledHelp.steps.length,
        'Completed help did not separate visible media from collapsed instructions',
      );
      helpGuidance.querySelector('summary').click();
      assert(helpGuidance.open, 'Help instructions could not be expanded');
      const helpWidth = frame.style.width;
      [320, 375, 390].forEach((width) => {
        frame.style.width = `${width}px`;
        win.dispatchEvent(new win.Event('resize'));
        assert(
          help.scrollWidth <= help.clientWidth
          && help.getBoundingClientRect().right <= win.innerWidth
          && help.querySelector('.chat-help-video-frame').getBoundingClientRect().height > 100
          && help.querySelector('.chat-help-video-play').getBoundingClientRect().width
            >= help.querySelector('.chat-help-video-frame').clientWidth - 1
          && helpGuidance.scrollWidth <= helpGuidance.clientWidth
          && helpGuidance.querySelector('summary').getBoundingClientRect().height >= 44,
          `Help media overflowed at ${width}px`,
        );
      });
      frame.style.width = helpWidth;
      win.dispatchEvent(new win.Event('resize'));
      const helpRequest = requests.at(-1);
      mode = 'complete';
      doc.querySelector('.chat-followup').click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'help-media follow-up request');
      assert(
        requests.at(-1).request.messages[0].content === 'Check my tag'
        && requests.at(-1).request.threadId === helpRequest.request.threadId
        && requests.at(-1).session === helpRequest.session && help.isConnected
        && helpGuidance.open,
        'Help follow-up lost its text, context or illustrations',
      );
      doc.querySelector('.chat-reset').click();
      assert(!help.isConnected && helpImages.every((image) => !image.hasAttribute('src')), 'Reset retained help assets');
      mode = 'help-question';
      await submit('Check my demo tag');
      const question = doc.querySelector('.chat-help-question');
      assert(
        question && doc.querySelectorAll('.chat-help-question').length === 1
        && question.querySelectorAll('button').length === 2
        && question.querySelectorAll('dd').length === 5
        && !doc.querySelector('.chat-tool-fallback,.chat-turn-status:not([hidden])'),
        'Text-only help question showed false warnings, lost fields or duplicated',
      );
      const questionWidth = frame.style.width;
      const accountDetails = question.querySelector('details');
      assert(
        !accountDetails.open && accountDetails.querySelectorAll('dd').length === 5
        && !accountDetails.querySelector('button,.chat-help-question-text'),
        'Completed question did not separate collapsed account details from answer controls',
      );
      accountDetails.querySelector('summary').click();
      assert(accountDetails.open, 'Account details could not be expanded');
      [320, 375, 390].forEach((width) => {
        frame.style.width = `${width}px`;
        win.dispatchEvent(new win.Event('resize'));
        assert(
          question.scrollWidth <= question.clientWidth
          && question.getBoundingClientRect().right <= win.innerWidth,
          `Help question overflowed at ${width}px`,
        );
      });
      frame.style.width = questionWidth;
      win.dispatchEvent(new win.Event('resize'));
      const questionRequest = requests.at(-1);
      mode = 'complete';
      question.querySelectorAll('button')[1].click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'help-question answer');
      assert(
        requests.at(-1).request.messages[0].content === 'No'
        && requests.at(-1).request.threadId === questionRequest.request.threadId
        && requests.at(-1).session === questionRequest.session && question.isConnected,
        'Question answer lost its text, conversation context or account check',
      );
      doc.querySelector('.chat-reset').click();
      assert(!question.isConnected, 'Reset retained an obsolete question');
      mode = 'help-outcome';
      const requestsBeforeOutcome = requests.length;
      await submit('Show my demo tag-check result');
      const outcome = doc.querySelector('.chat-help-outcome');
      assert(
        outcome && doc.querySelectorAll('.chat-help-outcome').length === 1
        && !doc.querySelector('.chat-tool-fallback,.chat-turn-status:not([hidden])')
        && outcome.querySelector('.chat-help-advice').textContent === sampleOutcome.advice
        && outcome.querySelector('.chat-help-question-text').textContent === sampleOutcome.offer.prompt
        && requests.length === requestsBeforeOutcome + 1,
        'Outcome lost data, duplicated, warned or automatically accepted an offer',
      );
      const outcomeImages = [...outcome.querySelectorAll('img')];
      outcomeImages.forEach((image) => { image.loading = 'eager'; });
      await waitFor(
        () => outcomeImages.length === 2
          && outcomeImages.every((image) => image.complete && image.naturalWidth > 0),
        'both outcome positioning illustrations',
      );
      assert(
        outcomeImages.every((image, index) => new URL(image.src).pathname
          === sampleOutcome.media[index].src && image.alt === sampleOutcome.media[index].alt)
        && [...outcome.querySelectorAll('figcaption')]
          .every((caption, index) => caption.textContent === sampleOutcome.media[index].caption),
        'Outcome illustration order, captions or alt text changed',
      );
      const outcomeGuidance = outcome.querySelector('.chat-help-details');
      assert(
        !outcomeGuidance.open
        && !outcomeGuidance.querySelector('.chat-help-question-text,.chat-help-media')
        && outcome.querySelector('.chat-help-question-text').getBoundingClientRect().height > 0,
        'Outcome disclosure hid the offer or failed to collapse supporting advice',
      );
      const outcomeWidth = frame.style.width;
      [320, 375, 390].forEach((width) => {
        frame.style.width = `${width}px`;
        win.dispatchEvent(new win.Event('resize'));
        assert(
          outcome.scrollWidth <= outcome.clientWidth
          && outcome.getBoundingClientRect().right <= win.innerWidth,
          `Help outcome overflowed at ${width}px`,
        );
      });
      frame.style.width = outcomeWidth;
      win.dispatchEvent(new win.Event('resize'));
      const outcomeRequest = requests.at(-1);
      mode = 'complete';
      doc.querySelectorAll('.chat-followup')[1].click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'outcome decline request');
      assert(
        requests.at(-1).request.messages[0].content === 'No thanks'
        && requests.at(-1).request.threadId === outcomeRequest.request.threadId
        && requests.at(-1).session === outcomeRequest.session && outcome.isConnected,
        'Outcome decline lost text, conversation context or illustrations',
      );
      doc.querySelector('.chat-reset').click();
      assert(
        !outcome.isConnected && outcomeImages.every((image) => !image.hasAttribute('src')),
        'Reset retained outcome assets',
      );
      mode = 'trip-unavailable';
      await submit('Explain my fictional missing trip');
      const unavailableTrip = doc.querySelector('.chat-trip-unavailable');
      const unavailableAnswer = unavailableTrip?.closest('.chat-message-received');
      assert(
        unavailableTrip && doc.querySelectorAll('.chat-trip-unavailable').length === 1
        && !doc.querySelector('.chat-turn-status:not([hidden]),.chat-tool-fallback')
        && ['Looking for your demo trip.', 'Demo trip unavailable.', 'Existing fictional dispute DEMO-CASE.', 'No trips were returned.']
          .every((content) => unavailableAnswer.textContent.includes(content))
        && doc.querySelectorAll('.chat-followup').length === 3,
        'Unavailable trip showed warnings, duplicated or lost text/list/dispute choices',
      );
      const unavailableWidth = frame.style.width;
      frame.style.width = '320px';
      win.dispatchEvent(new win.Event('resize'));
      assert(
        unavailableTrip.scrollWidth <= unavailableTrip.clientWidth
        && unavailableTrip.getBoundingClientRect().right <= win.innerWidth,
        'Unavailable trip overflowed on mobile',
      );
      frame.style.width = unavailableWidth;
      win.dispatchEvent(new win.Event('resize'));
      const unavailableRequest = requests.at(-1);
      mode = 'complete';
      doc.querySelector('.chat-followup').click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'dispute-status follow-up');
      assert(
        requests.at(-1).request.messages[0].content === 'Check my dispute status'
        && requests.at(-1).request.threadId === unavailableRequest.request.threadId
        && requests.at(-1).session === unavailableRequest.session && unavailableTrip.isConnected,
        'Dispute follow-up lost text, session, conversation or result',
      );
      doc.querySelector('.chat-reset').click();
      assert(!unavailableTrip.isConnected, 'Reset retained the unavailable trip');
      mode = 'trip-list';
      doc.querySelector('.chat-reset').click();
      await submit('Show my last ten trips');
      const tripList = doc.querySelector('.chat-trip-list');
      assert(
        doc.querySelectorAll('.chat-trip-list').length === 1
        && tripList.querySelectorAll('.chat-trip-item').length === 10
        && !doc.querySelector('.chat-turn-status:not([hidden])'),
        'Trip list was missing, duplicated, truncated or showed an unsupported notice',
      );
      const tripWidth = frame.style.width;
      frame.style.width = '375px';
      win.dispatchEvent(new win.Event('resize'));
      assert(
        tripList.scrollWidth <= tripList.clientWidth
        && tripList.getBoundingClientRect().right <= win.innerWidth
        && tripList.querySelector('.chat-trip-metadata').getBoundingClientRect().height > 0
        && !tripList.querySelector('details,[hidden]'),
        'Mobile trip list overflowed or hid metadata',
      );
      frame.style.width = tripWidth;
      win.dispatchEvent(new win.Event('resize'));
      const tripRequest = requests.at(-1);
      mode = 'complete';
      doc.querySelector('.chat-followup').click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'trip-list follow-up request');
      assert(
        requests.at(-1).request.messages[0].content === 'Check my tag'
        && requests.at(-1).request.threadId === tripRequest.request.threadId
        && requests.at(-1).session === tripRequest.session && tripList.isConnected,
        'Trip follow-up lost its text, context or rendered list',
      );
      mode = 'statement';
      doc.querySelector('.chat-reset').click();
      await submit('Show my latest statement');
      const statement = doc.querySelector('.chat-statement');
      assert(statement && doc.querySelectorAll('.chat-statement').length === 1, 'Statement card was missing or duplicated');
      assert(statement.querySelectorAll('tbody tr').length === 9, 'Statement transactions were not rendered in real chat');
      assert(
        !doc.querySelector('.chat-turn-status:not([hidden])')
        && !statement.querySelector('.chat-tool-fallback'),
        'Supported statement showed an unsupported or malformed-content warning',
      );
      assert(doc.querySelectorAll('.chat-followup').length === 3, 'Statement follow-up options were lost');
      const statementTable = statement.querySelector('.chat-statement-lines');
      const tableRegion = statement.querySelector('.chat-statement-table');
      assert(
        win.getComputedStyle(statementTable).display === 'table'
        && statementTable.getBoundingClientRect().width >= tableRegion.clientWidth * 0.98,
        'Statement table shrank to content width instead of filling its region',
      );
      assert(
        win.getComputedStyle(statement.querySelector('.chat-statement-balance-amount')).fontSize === '36px'
        && win.getComputedStyle(statement.querySelector('.chat-statement-badge')).backgroundColor === 'rgb(255, 241, 199)',
        'Statement balance hierarchy or due-status badge was not styled',
      );
      assert(
        statement.querySelector('.chat-statement-line-metadata').getBoundingClientRect().height < 60
        && statement.querySelector('tbody tr').getBoundingClientRect().height < 120,
        'Transaction metadata retained the old tall, single-field-per-line layout',
      );
      assert(!statement.querySelector('details,[hidden]'), 'Statement details were collapsed or hidden');
      const statementWidth = frame.style.width;
      frame.style.width = '390px';
      win.dispatchEvent(new win.Event('resize'));
      assert(
        statement.getBoundingClientRect().right <= win.innerWidth
        && statement.scrollWidth <= statement.clientWidth
        && statementTable.getBoundingClientRect().width >= tableRegion.clientWidth * 0.98,
        'Statement card overflowed on mobile',
      );
      assert(
        win.getComputedStyle(statement.querySelector('.chat-statement-financials'))
          .gridTemplateColumns.split(' ').length === 1
        && win.getComputedStyle(statement.querySelector('.chat-statement-tags'))
          .gridTemplateColumns.split(' ').length === 1
        && win.getComputedStyle(statement.querySelector('tbody tr')).display === 'grid'
        && statement.querySelector('tbody tr td:nth-child(2)').getBoundingClientRect().width
          > tableRegion.clientWidth * 0.8
        && statement.querySelectorAll('tbody tr').length === 9,
        'Mobile statement did not stack its panels/transaction details or retain all rows',
      );
      frame.style.width = statementWidth;
      win.dispatchEvent(new win.Event('resize'));
      const statementRequest = requests.at(-1);
      mode = 'complete';
      doc.querySelector('.chat-followup').click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'statement follow-up request');
      assert(
        requests.at(-1).request.messages[0].content === 'Why were trips matched by plate?'
        && requests.at(-1).request.threadId === statementRequest.request.threadId
        && requests.at(-1).session === statementRequest.session && statement.isConnected,
        'Statement follow-up changed context or removed the card',
      );
      mode = 'route';
      doc.querySelector('.chat-reset').click();
      await submit('Show the AWS route');
      assert(doc.querySelectorAll('.chat-route').length === 1, 'AWS map was missing or duplicated');
      assert(doc.querySelectorAll('.chat-followup').length === 2, 'AWS follow-ups were not rendered');
      assert(!doc.querySelector('.chat-turn-status:not([hidden])'), 'Supported tools showed a warning');
      await waitFor(
        () => doc.querySelector('.chat-route-map path[stroke-dasharray]'),
        'AWS Leaflet segment drawing',
      );
      const routeNode = doc.querySelector('.chat-route');
      assert(
        routeNode.firstElementChild.classList.contains('chat-route-map'),
        'Real chat did not render a map-first card',
      );
      assert(
        routeNode.querySelector('.chat-route-total').textContent === '$3.41',
        'Real chat omitted the compact price total',
      );
      assert(
        routeNode.querySelector('.leaflet-top.leaflet-right .leaflet-control-zoom'),
        'Map controls did not match the reference position',
      );
      assert(win.getComputedStyle(doc.querySelector('.chat-message-sent')).backgroundColor
        === 'rgb(227, 243, 233)', 'User bubble did not use the reference mint color');
      assert(
        win.getComputedStyle(doc.querySelector('.chat-followup')).borderRadius === '999px',
        'Follow-up actions did not use reference pill styling',
      );
      const received = routeNode.closest('.chat-message-received');
      assert(
        win.getComputedStyle(received).boxShadow === 'none'
        && win.getComputedStyle(received).borderRadius === '16px',
        'Assistant card retained the old bubble shadow or shape',
      );
      const originalWidth = frame.style.width;
      frame.style.width = '390px';
      win.dispatchEvent(new win.Event('resize'));
      // Background tabs throttle native resize observations.
      resizeObservers.forEach((callback, observer) => callback([], observer));
      const bounds = routeNode.getBoundingClientRect();
      assert(
        bounds.width > 250 && bounds.right <= win.innerWidth
        && routeNode.scrollWidth <= routeNode.clientWidth,
        'Route card overflowed on mobile',
      );
      const endpointsVisible = () => {
        const mapBounds = routeNode.querySelector('.chat-route-map').getBoundingClientRect();
        const markers = [...routeNode.querySelectorAll('.chat-route-map [role="img"]')];
        return markers.length === 4 && markers.every((marker) => {
          const markerBounds = marker.getBoundingClientRect();
          return markerBounds.left >= mapBounds.left && markerBounds.right <= mapBounds.right
            && markerBounds.top >= mapBounds.top && markerBounds.bottom <= mapBounds.bottom;
        });
      };
      await waitFor(endpointsVisible, 'route endpoints visible after mobile resize');
      frame.style.width = originalWidth;
      win.dispatchEvent(new win.Event('resize'));
      resizeObservers.forEach((callback, observer) => callback([], observer));
      await waitFor(endpointsVisible, 'route endpoints visible after desktop resize');
      const routeRequest = requests.at(-1);
      mode = 'complete';
      doc.querySelector('.chat-followup').click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'AWS follow-up request');
      const followUpRequest = requests.at(-1);
      assert(
        followUpRequest.request.messages[0].content === 'Check a different route',
        'Follow-up did not send its supplied text',
      );
      assert(followUpRequest.request.threadId === routeRequest.request.threadId
        && followUpRequest.session === routeRequest.session, 'Follow-up changed the thread/session');
      assert(routeNode.isConnected, 'A later answer removed the map');
      doc.querySelector('.chat-reset').click();
      assert(
        !routeNode.isConnected && !doc.querySelector('.chat-followup'),
        'Reset retained obsolete map or follow-ups',
      );
      mode = 'held';
      doc.querySelector('.chat-reset').click();
      doc.querySelector('.chat-field').value = 'Cancel on logout';
      doc.querySelector('.chat-input').requestSubmit();
      await waitFor(() => doc.querySelector('.chat-answer')?.textContent
        .includes('Held partial answer'), 'held stream output');
      doc.querySelector('.chat-dialog').close();
      doc.querySelector('.nav-auth-button').click();
      await waitFor(() => cancelled && doc.querySelector('.chat-field').disabled, 'logout cancellation');
      assert(!doc.querySelector('.chat-message'), 'Logout retained customer conversation content');
      assert(doc.querySelector('.nav-auth-button').textContent === 'Log in', 'Header did not reset');
      assert(!doc.querySelector('.nav-auth-status').hidden, 'Logout notice was hidden');
      assert(
        doc.querySelector('.chat-launcher-trigger span').textContent === 'Log in to chat',
        'Logout did not restore the launcher login prompt',
      );
      doc.querySelector('.nav-auth-button').click();
      await waitFor(() => !doc.querySelector('.chat-field').disabled, 'header login');
      assert(
        doc.querySelector('.nav-auth-button').textContent === 'Log out',
        'Header login did not share the chat session',
      );
      doc.querySelector('.nav-auth-button').click();
      doc.querySelector('.chat-launcher-trigger').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await waitFor(() => !doc.querySelector('.chat-field').disabled, 'keyboard launcher sign-in');
      assert(!doc.querySelector('.chat-dialog').open, 'Keyboard login opened the dialog');
      doc.querySelector('.chat-launcher-trigger').click();
      assert(doc.querySelector('.chat-dialog').open, 'Authenticated launcher did not open chat');
    } finally {
      frame.remove();
    }
  }],
  ...migrationCases,
];

const results = await Promise.all(cases.map(async ([name, run]) => {
  try {
    await run();
    return { name, passed: true };
  } catch (error) {
    return { name, passed: false, error: error.message };
  }
}));
const output = document.querySelector('#renderer-test-results');
const failures = results.filter((result) => !result.passed);
output.dataset.status = failures.length ? 'failed' : 'passed';
output.textContent = `${results.map((result) => `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`).join('\n')
}\n\n${results.length - failures.length}/${results.length} passed`;

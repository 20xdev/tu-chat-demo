import { createResponseRenderer, mergeResponseParts } from '../../scripts/chat-response.js';
import {
  answerParts, applyTurnEvent, createChatRequest, createTurnState, followUpOptions,
  parseRoutePlan, readA2AStream, routeGeometry, turnFinished,
} from '../../scripts/chat-stream.js';
import createToolViews from '../../scripts/chat-tools.js';
import { parseHelpMedia, resolveHelpMediaURL } from '../../scripts/chat-help.js';

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
  segments: [
    { tolled: false, points: [[144.96, -37.81], [144.95, -37.8]] },
    { tolled: true, points: [[144.9, -37.75], [144.85, -37.67]] },
  ],
  assumptions: ['Not a live quote'],
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
    const first = createChatRequest('First question', 'conversation-1', 'fixture-token');
    const second = createChatRequest('Second question', 'conversation-1', 'fixture-token');
    const a = JSON.parse(first.body);
    const b = JSON.parse(second.body);
    assert(first.method === 'POST' && first.headers['X-Chat-Access-Token'] === 'fixture-token', 'Authentication changed');
    assert(a.method === 'message/stream' && a.params.message.contextId === b.params.message.contextId, 'Conversation identity changed');
    assert(a.id !== b.id && a.params.message.messageId !== b.params.message.messageId, 'IDs were reused');
    assert(b.params.message.parts[0].text === 'Second question', 'Question was changed');
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
    assert(geometry.bounds.length === 6, 'Bounds omitted route points or markers');
  }],
  ['Hundreds of route coordinates are preserved without simplification', () => {
    const points = Array.from({ length: 900 }, (_, index) => [144 + index / 10000, -37]);
    const route = parseRoutePlan({ ...sampleRoute, segments: [{ tolled: true, points }] });
    const geometry = routeGeometry(route);
    const preserved = geometry.segments[0].points.length === 900 && geometry.bounds.length === 902;
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
      const media = ['C', 'D'].flatMap((tag) => ['insert', 'position', 'angle'].map((stage) => ({
        type: 'image',
        src: `/help/tags/${tag}-type-tag-${stage}-car.svg`,
        alt: `${tag}-type tag: ${stage}`,
      })));
      view.update(new Map([['helpMedia:bundled', {
        kind: 'helpMedia', value: { ...sampleHelp, media },
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
  ['Help video references never load embeds or thumbnails, regardless of consent', () => {
    const { host, view } = helpViews(sampleHelp);
    [false, true].forEach((consented) => {
      window.dispatchEvent(new CustomEvent('consent.update', { detail: { consented } }));
      assert(!host.querySelector('iframe,video,img'), 'Third-party media loaded before navigation');
    });
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
  ['Full chat flow preserves auth/context, blocks duplicates, and handles HTTP/SSE failures', async () => {
    const frame = document.createElement('iframe');
    frame.title = 'Isolated local chat regression';
    frame.hidden = true;
    frame.src = '/';
    document.body.append(frame);
    try {
      await waitFor(() => frame.contentDocument?.querySelector('.chat-field'), 'chat initialisation');
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      const originalFetch = win.fetch.bind(win);
      const requests = [];
      let mode = 'structured';
      win.fetch = (url, options) => {
        if (url !== '/__mock/a2a') return originalFetch(url, options);
        const request = JSON.parse(options.body);
        requests.push({ request, token: options.headers['X-Chat-Access-Token'] });
        if (mode === 'http-error' || mode === 'json-response') {
          return Promise.resolve(new win.Response('{"error":"fixture"}', {
            status: mode === 'http-error' ? 500 : 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        const events = mode === 'structured' ? [
          {
            result: status([text('Provisional'), tool('routePlan', { ok: false }),
              tool('helpMedia', {
                ...sampleHelp,
                media: [
                  { ...sampleHelp.media[0], src: '/help/tags/D-type-tag-insert-car.svg' },
                  { ...sampleHelp.media[1], src: '/help/tags/C-type-tag-insert-car.svg' },
                  sampleHelp.media[2],
                ],
              }), tool('followUps', { options: ['Ask again'] })]),
          },
          { result: { kind: 'artifact-update', artifact: { artifactId: 'a', parts: [text('Final answer')] }, lastChunk: true } },
          { result: status([], 'completed') },
        ] : [{ result: status([text('Partial answer')]) }];
        if (mode === 'rpc-error') events.push({ error: { code: -32603 } });
        if (mode === 'complete') events.push({ result: status([], 'completed') });
        return Promise.resolve(new win.Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ));
      };
      doc.querySelector('.chat-launcher-trigger').click();
      const submit = async (question) => {
        doc.querySelector('.chat-field').value = question;
        doc.querySelector('.chat-input').requestSubmit();
        await waitFor(() => doc.querySelector('.chat-messages')
          .getAttribute('aria-busy') === 'false', 'chat response');
      };
      await submit('Fixture question');
      assert(doc.querySelector('.chat-answer').textContent.trim() === 'Final answer', 'Answer duplicated');
      assert(doc.querySelector('.chat-tool-fallback'), 'Route fallback was lost');
      assert(
        doc.querySelector('.chat-help ol li').textContent === 'Insert the tag.',
        'Help instructions were lost when the final artifact arrived',
      );
      assert(doc.querySelectorAll('.chat-help img').length === 2, 'Bundled image URLs were not wired');
      const helpImages = [...doc.querySelectorAll('.chat-help img')];
      helpImages.forEach((image) => { image.loading = 'eager'; });
      await waitFor(
        () => helpImages.every((image) => image.complete && image.naturalWidth > 0),
        'bundled images inside the actual chat',
      );
      assert(!doc.querySelector('.chat-help iframe'), 'Video unexpectedly embedded');
      const followUp = doc.querySelector('.chat-followup');
      assert(followUp, 'Follow-up button was not rendered');
      mode = 'complete';
      followUp.click();
      followUp.click();
      await waitFor(() => doc.querySelector('.chat-messages')
        .getAttribute('aria-busy') === 'false', 'follow-up response');
      assert(requests.length === 2, 'Follow-up submitted twice');
      const [first, second] = requests.map((entry) => entry.request);
      assert(first.params.message.contextId === second.params.message.contextId, 'Context changed');
      assert(second.params.message.parts[0].text === 'Ask again', 'Follow-up text changed');
      assert(first.id !== second.id, 'Request ID was reused');
      assert(requests.every((entry) => entry.token === 'local-mock-only'), 'Mock auth isolation failed');
      doc.querySelector('.chat-reset').click();
      followUp.click();
      assert(requests.length === 2, 'A stale suggestion submitted into the new conversation');
      assert(!doc.querySelector('.chat-help'), 'Old help card leaked into the new conversation');
      await submit('New conversation');
      assert(
        requests[2].request.params.message.contextId !== first.params.message.contextId,
        'Reset reused the old conversation',
      );
      const failureModes = ['http-error', 'json-response', 'interrupted', 'rpc-error'];
      // eslint-disable-next-line no-restricted-syntax -- Sequential UI turns share one iframe.
      for (const failureMode of failureModes) {
        mode = failureMode;
        doc.querySelector('.chat-reset').click();
        // eslint-disable-next-line no-await-in-loop
        await submit(failureMode);
        assert(doc.querySelector('.chat-retry'), 'Failure did not offer retry');
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
    } finally {
      frame.remove();
    }
  }],
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

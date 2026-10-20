import { createResponseRenderer, mergeResponseParts } from '../../scripts/chat-response.js';

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

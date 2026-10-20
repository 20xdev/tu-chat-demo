const frame = document.querySelector('iframe');
const run = document.querySelector('#run');
const status = document.querySelector('#status');
const enhanced = document.querySelector('#enhanced');
const mobile = document.querySelector('#mobile');
let ready = false;

function sizeFrame() {
  document.body.style.setProperty('--toolbar-height', `${document.querySelector('header').offsetHeight + status.offsetHeight}px`);
}
new ResizeObserver(sizeFrame).observe(document.querySelector('header'));
new ResizeObserver(sizeFrame).observe(status);
window.addEventListener('resize', sizeFrame);

function applyStyles() {
  const doc = frame.contentDocument;
  const sheet = doc?.querySelector('#mock-experimental-css');
  if (sheet) {
    if (doc.head.lastElementChild !== sheet) doc.head.append(sheet);
    sheet.disabled = false;
    sheet.media = enhanced.checked ? 'all' : 'not all';
  }
}
enhanced.addEventListener('change', applyStyles);
mobile.addEventListener('change', () => frame.classList.toggle('mobile', mobile.checked));

const questions = {
  journey: 'Plan a sample journey for me.',
  compare: 'Show me the fictional pass comparison.',
  notice: 'Walk me through a sample toll notice.',
  image: 'Show an image and a missing-image fallback.',
  media: 'Show image attachments, base64 images, SVG and icons.',
  slow: 'Show the loading and streaming states.',
  error: 'Show a failed request so I can try again.',
};

run.addEventListener('click', () => {
  const doc = frame.contentDocument;
  if (doc.querySelector('.chat-messages')?.getAttribute('aria-busy') === 'true') {
    status.textContent = 'A mock is still streaming. Wait for it to finish before starting another.';
    return;
  }
  const scenario = document.querySelector('#scenario').value;
  doc.body.dataset.mockScenario = scenario;
  if (!doc.querySelector('.chat-dialog').open) doc.querySelector('.chat-launcher-trigger').click();
  doc.querySelector('.chat-reset').click();
  const field = doc.querySelector('.chat-field');
  field.value = `[demo:${scenario}] ${questions[scenario]}`;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  doc.querySelector('.chat-input').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  if (scenario === 'error') {
    status.textContent = 'Intentional mock failure. Click "Try again" inside the chat to see recovery.';
  } else if (scenario === 'slow') {
    status.textContent = 'Mock waits 4.5 seconds, then streams. Toggle experimental styles to compare.';
  } else {
    status.textContent = `Fictional fixture streaming from ${window.location.host}. Toggle styles or mobile width at any time.`;
  }
});

const poll = setInterval(() => {
  const doc = frame.contentDocument;
  if (!doc?.querySelector('.chat-field')) return;
  applyStyles();
  if (!ready) {
    ready = true;
    run.disabled = false;
    status.textContent = 'Ready. All API responses are local fixtures. Experimental CSS is isolated to this preview.';
    run.click();
  }
  const pending = doc.querySelector('.chat-messages')?.getAttribute('aria-busy') === 'true';
  run.disabled = pending;
}, 150);
window.addEventListener('pagehide', () => clearInterval(poll), { once: true });

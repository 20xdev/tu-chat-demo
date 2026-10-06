const content = {
  title: 'Linkt Assistant',
  label: 'AI assistant',
  heading: 'How can we help with your journey?',
  introduction: 'Tolls, passes and account questions. Let\'s get you on your way.',
  prompts: [
    'How do I pay a toll?',
    'Which pass do I need?',
    'How do I update my vehicle?',
    'I have a toll notice',
  ],
  placeholder: 'Ask about Linkt',
  notice: 'AI responses may be inaccurate. Never share passwords or payment details.',
};

export default function decorate(block) {
  block.textContent = '';

  const iconURL = 'https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/';
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'chat-launcher';
  launcher.setAttribute('aria-label', 'Open Linkt Assistant');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.title = 'Open Linkt Assistant';
  const launcherIcon = document.createElement('img');
  launcherIcon.src = `${iconURL}message-circle.svg`;
  launcherIcon.alt = '';
  launcher.append(launcherIcon);

  const panel = document.createElement('dialog');
  panel.className = 'chat-dialog';
  panel.id = `chat-panel-${document.querySelectorAll('.chat-dialog').length + 1}`;
  launcher.setAttribute('aria-controls', panel.id);

  const header = document.createElement('div');
  header.className = 'chat-header';
  const identity = document.createElement('div');
  identity.className = 'chat-identity';
  const title = document.createElement('p');
  title.className = 'chat-title';
  title.id = `${panel.id}-title`;
  title.textContent = content.title;
  panel.setAttribute('aria-labelledby', title.id);
  const label = document.createElement('span');
  label.className = 'chat-label';
  label.textContent = content.label;
  identity.append(title, label);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'chat-close';
  closeButton.setAttribute('aria-label', 'Close chat');
  closeButton.title = 'Close chat';
  const closeIcon = document.createElement('img');
  closeIcon.src = `${iconURL}x.svg`;
  closeIcon.alt = '';
  closeButton.append(closeIcon);
  header.append(identity, closeButton);

  const welcome = document.createElement('div');
  welcome.className = 'chat-welcome';
  const heading = document.createElement('h2');
  heading.textContent = content.heading;
  const introduction = document.createElement('p');
  introduction.textContent = content.introduction;
  const suggestions = document.createElement('div');
  suggestions.className = 'chat-suggestions';
  welcome.append(heading, introduction, suggestions);

  const messages = document.createElement('div');
  messages.className = 'chat-messages';
  messages.setAttribute('role', 'log');
  messages.setAttribute('aria-label', 'Conversation');
  messages.hidden = true;

  const form = document.createElement('form');
  form.className = 'chat-input';
  const field = document.createElement('textarea');
  field.className = 'chat-field';
  field.rows = 1;
  field.placeholder = content.placeholder;
  field.setAttribute('aria-label', content.placeholder);

  const sendButton = document.createElement('button');
  sendButton.type = 'submit';
  sendButton.className = 'chat-send';
  sendButton.setAttribute('aria-label', 'Send');
  sendButton.title = 'Send';
  sendButton.disabled = true;

  const notice = document.createElement('p');
  notice.className = 'chat-notice';
  notice.textContent = content.notice;
  form.append(field, sendButton);
  panel.append(header, welcome, messages, form, notice);
  block.append(launcher, panel);
  let previousOverflow;
  function updateViewport() {
    if (!panel.open || !window.visualViewport) return;
    panel.style.setProperty('--chat-viewport-height', `${window.visualViewport.height}px`);
    panel.style.setProperty('--chat-viewport-top', `${window.visualViewport.offsetTop}px`);
  }
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  launcher.addEventListener('click', () => {
    previousOverflow = document.body.style.overflow;
    panel.showModal();
    updateViewport();
    document.body.style.overflow = 'hidden';
    launcher.setAttribute('aria-expanded', 'true');
    messages.scrollTop = messages.scrollHeight;
    closeButton.focus();
  });
  closeButton.addEventListener('click', () => panel.close());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      panel.close();
    }
  });
  panel.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  });
  let pending = false;
  let markdownLibraries;
  let renderMarkdown;
  let responseText = '';

  function addMessage(text, type) {
    const message = document.createElement('div');
    message.className = `chat-message chat-message-${type}`;
    message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function appendChunk(message, data) {
    if (data === '[DONE]') return true;
    const { text } = JSON.parse(data);
    if (typeof text !== 'string' || !text) return false;
    if (message.classList.contains('chat-message-loading')) {
      message.textContent = '';
      message.classList.remove('chat-message-loading');
    }
    responseText += text;
    message.innerHTML = renderMarkdown(responseText);
    message.querySelectorAll('a').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    messages.scrollTop = messages.scrollHeight;
    return false;
  }

  async function reply(userInput, message) {
    if (!markdownLibraries) {
      const markdownURL = 'https://cdn.jsdelivr.net/npm/marked@18.1.0/lib/marked.esm.js';
      const sanitizerURL = 'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.es.mjs';
      markdownLibraries = Promise.all([import(markdownURL), import(sanitizerURL)])
        .catch((error) => {
          markdownLibraries = undefined;
          throw error;
        });
    }
    const [{ marked }, { default: DOMPurify }] = await markdownLibraries;
    renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(text, { breaks: true }), {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
        'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      ],
      ALLOWED_ATTR: ['href', 'title', 'start'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    const res = await fetch('https://tu-chat-server.vercel.app/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: userInput }] }),
    });
    if (!res.ok || !res.body) throw new Error('Chat request failed');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    try {
      while (!done) {
        // eslint-disable-next-line no-await-in-loop
        const chunk = await reader.read();
        done = chunk.done;
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        if (done && buffer.trim()) lines.push(buffer);
        const finished = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter(Boolean)
          .some((data) => appendChunk(message, data));
        if (finished) {
          // eslint-disable-next-line no-await-in-loop
          await reader.cancel();
          done = true;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (message.classList.contains('chat-message-loading')) throw new Error('Empty response');
  }

  async function respond(text, message) {
    pending = true;
    responseText = '';
    sendButton.disabled = true;
    message.textContent = 'Thinking...';
    message.classList.add('chat-message-loading');
    messages.setAttribute('aria-busy', 'true');
    try {
      await reply(text, message);
    } catch {
      message.classList.remove('chat-message-loading');
      message.textContent = 'Something went wrong. Please try again.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'chat-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => {
        if (!pending) respond(text, message);
      });
      message.append(retry);
    } finally {
      pending = false;
      sendButton.disabled = !field.value.trim();
      messages.setAttribute('aria-busy', 'false');
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function send() {
    const text = field.value.trim();
    if (!text || pending) return;
    welcome.hidden = true;
    messages.hidden = false;
    addMessage(text, 'sent');
    field.value = '';
    field.style.height = 'auto';
    respond(text, addMessage('', 'received'));
    field.focus();
  }

  content.prompts.forEach((prompt) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-suggestion';
    button.textContent = prompt;
    button.addEventListener('click', () => {
      field.value = prompt;
      send();
    });
    suggestions.append(button);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  field.addEventListener('input', () => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
    sendButton.disabled = pending || !field.value.trim();
  });

  return block;
}

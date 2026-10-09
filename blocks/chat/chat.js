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

  let conversationId = crypto.randomUUID();
  const iconURL = 'https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons/';
  const launcher = document.createElement('div');
  launcher.className = 'chat-launcher';
  const launcherField = document.createElement('button');
  launcherField.type = 'button';
  launcherField.className = 'chat-launcher-trigger';
  const launcherTitle = document.createElement('strong');
  launcherTitle.textContent = content.title;
  const launcherPrompt = document.createElement('span');
  launcherPrompt.textContent = content.placeholder;
  launcherField.append(launcherTitle, launcherPrompt);
  launcherField.setAttribute('aria-label', 'Open Linkt Assistant');
  const expandButton = document.createElement('button');
  expandButton.type = 'button';
  expandButton.setAttribute('aria-label', 'Expand chat');
  expandButton.title = 'Expand chat';
  const launcherIcon = document.createElement('img');
  launcherIcon.className = 'chat-launcher-icon';
  launcherIcon.src = `${iconURL}chevron-up.svg`;
  launcherIcon.alt = '';
  expandButton.append(launcherIcon);
  const launcherCar = document.createElement('img');
  launcherCar.className = 'chat-launcher-car';
  launcherCar.src = `${iconURL}car-front.svg`;
  launcherCar.alt = '';
  launcher.append(launcherCar, launcherField, expandButton);

  const panel = document.createElement('dialog');
  panel.className = 'chat-dialog';
  panel.id = `chat-panel-${document.querySelectorAll('.chat-dialog').length + 1}`;
  [launcherField, expandButton].forEach((control) => {
    control.setAttribute('aria-controls', panel.id);
    control.setAttribute('aria-haspopup', 'dialog');
    control.setAttribute('aria-expanded', 'false');
  });

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
  closeButton.setAttribute('aria-label', 'Minimize chat');
  closeButton.title = 'Minimize chat';
  const closeIcon = document.createElement('img');
  closeIcon.src = `${iconURL}chevron-down.svg`;
  closeIcon.alt = '';
  closeButton.append(closeIcon);
  const avatar = document.createElement('img');
  avatar.className = 'chat-avatar';
  avatar.src = `${iconURL}car-front.svg`;
  avatar.alt = '';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'chat-reset';
  resetButton.setAttribute('aria-label', 'New conversation');
  resetButton.title = 'New conversation';
  resetButton.disabled = true;
  const resetIcon = document.createElement('img');
  resetIcon.src = `${iconURL}square-pen.svg`;
  resetIcon.alt = '';
  resetButton.append(resetIcon);
  header.append(avatar, identity, resetButton, closeButton);

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
  const sendIcon = document.createElement('img');
  sendIcon.src = `${iconURL}arrow-up.svg`;
  sendIcon.alt = '';
  sendButton.append(sendIcon);

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
  function openChat() {
    if (panel.open) return;
    previousOverflow = document.body.style.overflow;
    panel.showModal();
    updateViewport();
    document.body.style.overflow = 'hidden';
    launcher.hidden = true;
    [launcherField, expandButton].forEach((control) => control.setAttribute('aria-expanded', 'true'));
    messages.scrollTop = messages.scrollHeight;
    field.focus();
  }
  launcher.addEventListener('click', openChat);
  launcherField.addEventListener('keydown', (event) => {
    if (['Enter', ' ', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openChat();
    }
  });
  async function closeChat() {
    if (!panel.open || panel.classList.contains('chat-closing')) return;
    panel.classList.add('chat-closing');
    await Promise.all(panel.getAnimations().map((animation) => animation.finished.catch(() => {})));
    panel.close();
  }
  closeButton.addEventListener('click', closeChat);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeChat();
    }
  });
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeChat();
  });
  panel.addEventListener('close', () => {
    panel.classList.remove('chat-closing');
    document.body.style.overflow = previousOverflow;
    launcher.hidden = false;
    launcherPrompt.textContent = field.value.trim() || content.placeholder;
    [launcherField, expandButton].forEach((control) => control.setAttribute('aria-expanded', 'false'));
    launcherField.focus();
  });
  let pending = false;
  let markdownLibraries;
  let renderMarkdown;
  let responseText = '';

  resetButton.addEventListener('click', () => {
    if (pending) return;
    conversationId = crypto.randomUUID();
    messages.replaceChildren();
    messages.hidden = true;
    welcome.hidden = false;
    field.value = '';
    field.style.height = 'auto';
    sendButton.disabled = true;
    resetButton.disabled = true;
    field.focus();
  });

  function addMessage(text, type) {
    const message = document.createElement('div');
    message.className = `chat-message chat-message-${type}`;
    message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function decorateResponse(message) {
    message.querySelectorAll('img').forEach((image) => {
      const source = image.getAttribute('src');
      const fallback = document.createElement('span');
      fallback.className = 'chat-image-fallback';
      fallback.textContent = image.alt || 'Image unavailable';
      let safeSource = false;
      try {
        safeSource = Boolean(source) && ['https:', 'http:'].includes(new URL(source, window.location.href).protocol);
      } catch {
        safeSource = false;
      }
      if (!safeSource) {
        image.replaceWith(fallback);
        return;
      }
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.replaceWith(fallback), { once: true });
      image.addEventListener('load', () => {
        if (pending) messages.scrollTop = messages.scrollHeight;
      }, { once: true });
    });
    const signals = {
      '\u{1F534}': ['red', 'Red status'],
      '\u{1F7E1}': ['amber', 'Amber status'],
      '\u{1F7E2}': ['green', 'Green status'],
    };
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((textNode) => {
      if (textNode.parentElement.closest('pre, code')) return;
      const parts = textNode.textContent.split(/([\u{1F534}\u{1F7E1}\u{1F7E2}])/u);
      if (parts.length === 1) return;
      textNode.replaceWith(...parts.map((part) => {
        if (!signals[part]) return document.createTextNode(part);
        const [color, description] = signals[part];
        const signal = document.createElement('span');
        signal.className = `chat-signal chat-signal-${color}`;
        signal.setAttribute('role', 'img');
        signal.setAttribute('aria-label', description);
        signal.title = description;
        return signal;
      }));
    });
    message.querySelectorAll('a').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
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
    decorateResponse(message);
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
        'img',
      ],
      ALLOWED_ATTR: ['href', 'title', 'start', 'src', 'alt'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
    });
    const tokenCookie = document.cookie.split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith('CHAT_ACCESS_TOKEN='));
    const chatAccessToken = tokenCookie
      ? decodeURIComponent(tokenCookie.slice('CHAT_ACCESS_TOKEN='.length)) : null;
    const res = await fetch('https://391665-624violetduck.adobeioruntime.net/api/v1/web/tu-appbuilder-chat-server/chat.http', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Chat-Access-Token': chatAccessToken,
      },
      body: JSON.stringify({
        conversationId,
        messages: [{ role: 'user', text: userInput }],
      }),
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
    resetButton.disabled = true;
    messages.querySelectorAll('.chat-retry').forEach((button) => { button.disabled = true; });
    message.classList.remove('chat-message-error');
    const indicator = document.createElement('span');
    indicator.className = 'chat-loading-bars';
    indicator.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 3; index += 1) {
      indicator.append(document.createElement('span'));
    }
    const status = document.createElement('span');
    status.className = 'chat-loading-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Preparing a response...';
    message.replaceChildren(indicator, status);
    message.classList.add('chat-message-loading');
    messages.setAttribute('aria-busy', 'true');
    try {
      await reply(text, message);
    } catch {
      message.classList.remove('chat-message-loading');
      message.classList.add('chat-message-error');
      if (!responseText) message.replaceChildren();
      const error = document.createElement('div');
      error.className = 'chat-error';
      error.setAttribute('role', 'alert');
      const errorIcon = document.createElement('img');
      errorIcon.className = 'chat-error-icon';
      errorIcon.src = `${iconURL}circle-alert.svg`;
      errorIcon.alt = '';
      const errorBody = document.createElement('div');
      const errorTitle = document.createElement('strong');
      errorTitle.textContent = responseText ? 'Response interrupted' : "We couldn't get a response";
      const errorDescription = document.createElement('p');
      errorDescription.className = 'chat-error-description';
      errorDescription.textContent = responseText
        ? 'Try again for a complete answer.' : 'Please try again in a moment.';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'chat-retry';
      const retryIcon = document.createElement('img');
      retryIcon.src = `${iconURL}rotate-cw.svg`;
      retryIcon.alt = '';
      retry.append(retryIcon, document.createTextNode('Try again'));
      retry.addEventListener('click', () => {
        if (!pending) respond(text, message);
      });
      errorBody.append(errorTitle, errorDescription, retry);
      error.append(errorIcon, errorBody);
      message.append(error);
    } finally {
      pending = false;
      sendButton.disabled = !field.value.trim();
      resetButton.disabled = false;
      messages.querySelectorAll('.chat-retry').forEach((button) => { button.disabled = false; });
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

  const promptIcons = ['credit-card', 'ticket', 'car-front', 'file-text'];
  content.prompts.forEach((prompt, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-suggestion';
    const promptIcon = document.createElement('img');
    promptIcon.className = 'chat-suggestion-icon';
    promptIcon.src = `${iconURL}${promptIcons[index]}.svg`;
    promptIcon.alt = '';
    const promptText = document.createElement('span');
    promptText.textContent = prompt;
    button.append(promptIcon, promptText);
    const arrow = document.createElement('img');
    arrow.className = 'chat-suggestion-arrow';
    arrow.src = `${iconURL}arrow-up-right.svg`;
    arrow.alt = '';
    button.append(arrow);
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

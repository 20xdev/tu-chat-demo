import { createResponseRenderer } from '../../scripts/chat-response.js';
import {
  aguiAnswerParts, aguiNotice, createAGUIRequest, createAGUITurn, readAGUIStream,
} from '../../scripts/chat-agui.js';
import { chatAuth } from '../../scripts/chat-auth.js';
import createToolViews from '../../scripts/chat-tools.js';

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
  let runtimeSessionId = crypto.randomUUID();
  let authState = { status: 'loading' };
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

  const authBar = document.createElement('div');
  authBar.className = 'chat-auth';
  const authStatus = document.createElement('p');
  authStatus.className = 'chat-auth-status';
  authStatus.setAttribute('role', 'status');
  const authButton = document.createElement('button');
  authButton.type = 'button';
  authButton.className = 'chat-auth-button';
  authButton.textContent = 'Sign in';
  authButton.disabled = true;
  authBar.append(authStatus, authButton);

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
  field.disabled = true;

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
  panel.append(header, authBar, welcome, messages, form, notice);
  block.append(launcher, panel);
  let previousOverflow;
  function updateViewport() {
    if (!panel.open || !window.visualViewport) return;
    panel.style.setProperty('--chat-viewport-width', `${window.visualViewport.width}px`);
    panel.style.setProperty('--chat-viewport-height', `${window.visualViewport.height}px`);
    panel.style.setProperty('--chat-viewport-top', `${window.visualViewport.offsetTop}px`);
    panel.style.setProperty('--chat-viewport-left', `${window.visualViewport.offsetLeft}px`);
  }
  window.addEventListener('resize', updateViewport);
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
  let renderResponse;
  let activeTurn;
  const turns = new Map();

  function disposeTurn(turn) {
    turn.disposed = true;
    turn.controller.abort();
    turn.state.customEvents.length = 0;
    turn.tools.dispose();
    turns.delete(turn.message);
  }

  function resetConversation() {
    turns.forEach(disposeTurn);
    activeTurn = undefined;
    conversationId = crypto.randomUUID();
    runtimeSessionId = crypto.randomUUID();
    pending = false;
    messages.replaceChildren();
    messages.hidden = true;
    welcome.hidden = false;
    field.value = '';
    field.style.height = 'auto';
    sendButton.disabled = true;
    resetButton.disabled = true;
    messages.setAttribute('aria-busy', 'false');
    field.focus();
  }
  resetButton.addEventListener('click', () => {
    if (!pending) resetConversation();
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

  function updateNotice(turn) {
    turn.notice.textContent = aguiNotice(turn.state);
    turn.notice.hidden = !turn.notice.textContent;
    turn.hasResponse = !turn.answer.hidden || !turn.toolContainer.hidden || !turn.notice.hidden;
  }

  function updateTurn(turn) {
    if (turn.disposed || turn.contextId !== conversationId || !turn.message.isConnected) return;
    if (turn.renderedVersion !== turn.state.answerVersion) {
      turn.answer.replaceChildren(renderResponse(aguiAnswerParts(turn.state)));
      turn.answer.hidden = !turn.answer.hasChildNodes();
      decorateResponse(turn.answer);
      turn.renderedVersion = turn.state.answerVersion;
    }
    turn.tools.update(turn.state.tools);
    updateNotice(turn);
    if (turn.hasResponse) {
      turn.indicator.remove();
      turn.loadingStatus.remove();
      turn.message.classList.remove('chat-message-loading');
    } else if (!turn.state.closed) {
      turn.message.prepend(turn.indicator, turn.loadingStatus);
      turn.message.classList.add('chat-message-loading');
    }
    messages.scrollTop = messages.scrollHeight;
  }

  async function reply(userInput, turn) {
    const config = await chatAuth.initialize();
    let accessToken = await chatAuth.getAccessToken();
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
    if (turn.disposed || turn.contextId !== conversationId) return;
    renderResponse = createResponseRenderer(marked, DOMPurify);
    const { contextId, sessionId, state } = turn;
    const request = createAGUIRequest(userInput, contextId, sessionId, accessToken, state.runId);
    const requestForTurn = () => ({
      ...request,
      headers: { ...request.headers, Authorization: `Bearer ${accessToken}` },
      signal: turn.controller.signal,
    });
    let res = await fetch(config.agentEndpoint, requestForTurn());
    if (res.status === 401) {
      await res.body?.cancel();
      accessToken = await chatAuth.getAccessToken({ forceRefresh: true });
      if (turn.disposed || turn.contextId !== conversationId) return;
      res = await fetch(config.agentEndpoint, requestForTurn());
    }
    if (res.status === 401) {
      await res.body?.cancel();
      chatAuth.requireSignIn();
      throw new Error('Chat authorization was rejected. Please sign in again.');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(res.status === 403
        ? 'Your signed-in account does not have access to this agent.'
        : `Chat request failed (HTTP ${res.status}).`);
    }
    if (!res.body) throw new Error('The chat service returned no response stream.');
    if (!res.headers.get('content-type')?.includes('text/event-stream')) {
      await res.body.cancel();
      throw new Error('Expected a chat event stream');
    }
    await readAGUIStream(res.body, turn.state, () => {
      if (turn.disposed || turn.contextId !== conversationId) return;
      updateTurn(turn);
    });
    if (turn.disposed) return;
    updateTurn(turn);
    if (!turn.hasResponse) throw new Error('Empty response');
  }

  function setBusy(value) {
    pending = value;
    const authenticated = authState.status === 'authenticated';
    sendButton.disabled = value || !authenticated || !field.value.trim();
    field.disabled = !authenticated;
    suggestions.querySelectorAll('button').forEach((button) => {
      button.disabled = value || !authenticated;
    });
    resetButton.disabled = value || !authenticated || !turns.size;
    messages.querySelectorAll('.chat-retry').forEach((button) => { button.disabled = value; });
    turns.forEach((turn) => turn.tools.setBusy(value));
    messages.setAttribute('aria-busy', String(value));
  }

  async function respond(text, message) {
    if (pending) return;
    if (turns.has(message)) disposeTurn(turns.get(message));
    const turn = {
      message,
      contextId: conversationId,
      sessionId: runtimeSessionId,
      controller: new AbortController(),
      state: createAGUITurn(conversationId),
      renderedVersion: -1,
      hasResponse: false,
      disposed: false,
      answer: document.createElement('div'),
      toolContainer: document.createElement('div'),
      notice: document.createElement('p'),
    };
    turn.answer.className = 'chat-answer';
    turn.toolContainer.className = 'chat-tools';
    turn.notice.className = 'chat-turn-status';
    turn.answer.hidden = true;
    turn.toolContainer.hidden = true;
    turn.notice.hidden = true;
    turn.tools = createToolViews(turn.toolContainer, (option) => {
      if (pending || turn.disposed || turn.contextId !== conversationId) return;
      field.value = option;
      form.requestSubmit();
    });
    turns.set(message, turn);
    activeTurn = turn;
    setBusy(true);
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
    turn.indicator = indicator;
    turn.loadingStatus = status;
    message.replaceChildren(indicator, status, turn.answer, turn.toolContainer, turn.notice);
    message.classList.add('chat-message-loading');
    try {
      await reply(text, turn);
    } catch (failure) {
      if (turn.disposed || turn.contextId !== conversationId) return;
      turn.state.progress.clear();
      updateNotice(turn);
      turn.indicator.remove();
      turn.loadingStatus.remove();
      message.classList.remove('chat-message-loading');
      message.classList.add('chat-message-error');
      if (!turn.hasResponse) message.replaceChildren();
      const error = document.createElement('div');
      error.className = 'chat-error';
      error.setAttribute('role', 'alert');
      const errorIcon = document.createElement('img');
      errorIcon.className = 'chat-error-icon';
      errorIcon.src = `${iconURL}circle-alert.svg`;
      errorIcon.alt = '';
      const errorBody = document.createElement('div');
      const errorTitle = document.createElement('strong');
      errorTitle.textContent = turn.hasResponse ? 'Response interrupted' : "We couldn't get a response";
      const errorDescription = document.createElement('p');
      errorDescription.className = 'chat-error-description';
      errorDescription.textContent = failure instanceof Error
        ? failure.message : 'Chat failed. Please try again.';
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
      if (activeTurn === turn && !turn.disposed) {
        setBusy(false);
        messages.scrollTop = messages.scrollHeight;
      }
    }
  }

  function send() {
    const text = field.value.trim();
    if (!text || pending || authState.status !== 'authenticated') return;
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
    sendButton.disabled = pending || authState.status !== 'authenticated' || !field.value.trim();
  });

  function showAuthError(error) {
    authStatus.textContent = error instanceof Error ? error.message : 'Chat sign-in failed.';
    authStatus.setAttribute('role', 'alert');
    authButton.disabled = false;
  }
  authButton.addEventListener('click', async () => {
    authButton.disabled = true;
    try {
      if (authState.status === 'authenticated') chatAuth.logout();
      else if (authState.status === 'error') await chatAuth.initialize();
      else await chatAuth.login();
    } catch (error) {
      showAuthError(error);
    }
  });
  const unsubscribeAuth = chatAuth.subscribe((state) => {
    const previous = authState.status;
    authState = state;
    if (previous === 'authenticated' && state.status !== 'authenticated') resetConversation();
    authStatus.textContent = state.message;
    authStatus.setAttribute('role', state.status === 'error' ? 'alert' : 'status');
    const labels = { authenticated: 'Sign out', error: 'Retry setup' };
    authButton.textContent = labels[state.status] || 'Sign in';
    authButton.disabled = ['loading', 'signing-in'].includes(state.status);
    setBusy(pending);
  });
  chatAuth.initialize().catch(showAuthError);

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    turns.forEach(disposeTurn);
    unsubscribeAuth();
    window.removeEventListener('resize', updateViewport);
    window.visualViewport?.removeEventListener('resize', updateViewport);
    window.visualViewport?.removeEventListener('scroll', updateViewport);
  }, { once: true });

  return block;
}

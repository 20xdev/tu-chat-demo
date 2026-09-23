export default function decorate(block) {
  block.textContent = '';

  const messages = document.createElement('div');
  messages.className = 'chat-messages';

  const form = document.createElement('form');
  form.className = 'chat-input';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'chat-add';
  addButton.setAttribute('aria-label', 'Add');
  addButton.textContent = '+';

  const field = document.createElement('textarea');
  field.className = 'chat-field';
  field.rows = 1;
  field.placeholder = 'Ask anything';
  field.setAttribute('aria-label', 'Ask anything');

  const sendButton = document.createElement('button');
  sendButton.type = 'submit';
  sendButton.className = 'chat-send';
  sendButton.setAttribute('aria-label', 'Send');

  form.append(addButton, field, sendButton);
  block.append(messages, form);

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
    message.textContent += text;
    messages.scrollTop = messages.scrollHeight;
    return false;
  }

  async function reply(userInput, message) {
    const res = await fetch('https://tu-chat-server.vercel.app/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: userInput }] }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      done = chunk.done;
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .some((data) => appendChunk(message, data));
    }
  }

  async function send() {
    const text = field.value.trim();
    if (!text) return;
    addMessage(text, 'sent');
    field.value = '';
    field.style.height = 'auto';
    const message = addMessage('', 'received');
    try {
      await reply(text, message);
    } catch {
      message.textContent = 'Something went wrong. Please try again.';
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });

  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  field.addEventListener('input', () => {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  });

  return block;
}

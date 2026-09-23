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
  }

  function send() {
    const text = field.value.trim();
    if (!text) return;
    addMessage(text, 'sent');
    field.value = '';
    field.style.height = 'auto';
    // simulate a received reply until a real backend is wired up
    setTimeout(() => addMessage(`You said: "${text}"`, 'received'), 600);
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

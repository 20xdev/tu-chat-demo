import { readEventStream, upsertTool } from './chat-stream.js';

const CUSTOM_LIMIT = 20;
const CUSTOM_BYTES = 64 * 1024;
const OTHER_EVENTS = new Set([
  'TOOL_CALL_ARGS', 'TOOL_CALL_RESULT', 'STATE_SNAPSHOT', 'STATE_DELTA',
  'MESSAGES_SNAPSHOT', 'RAW', 'STEP_STARTED', 'STEP_FINISHED',
]);

export function createAGUIRequest(
  text,
  threadId,
  sessionId,
  accessToken,
  runId = crypto.randomUUID(),
) {
  return {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': sessionId,
    },
    body: JSON.stringify({
      threadId,
      runId,
      state: {},
      messages: [{ id: crypto.randomUUID(), role: 'user', content: text }],
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  };
}

export function createAGUITurn(threadId) {
  return {
    threadId,
    runId: crypto.randomUUID(),
    messages: new Map(),
    tools: new Map(),
    progress: new Map(),
    customEvents: [],
    customBytes: 0,
    customTruncated: false,
    unsupportedContent: false,
    answerVersion: 0,
    closed: false,
    outcome: null,
  };
}

function identifier(value) {
  return typeof value === 'string' && value.trim();
}

export function applyAGUIEvent(state, event) {
  if (!event || typeof event !== 'object' || !identifier(event.type)) {
    throw new Error('The chat stream contained an invalid AG-UI event.');
  }
  if ((event.threadId !== undefined && !identifier(event.threadId))
    || (event.runId !== undefined && !identifier(event.runId))) {
    throw new Error('The chat stream contained invalid conversation identifiers.');
  }
  if ((event.threadId && event.threadId !== state.threadId)
    || (event.runId && event.runId !== state.runId) || state.closed) return;
  switch (event.type) {
    case 'RUN_STARTED':
      break;
    case 'RUN_FINISHED':
      state.closed = true;
      state.outcome = 'completed';
      state.progress.clear();
      break;
    case 'RUN_ERROR':
      state.closed = true;
      state.outcome = 'failed';
      state.progress.clear();
      throw new Error(typeof event.message === 'string' && event.message.trim()
        ? event.message.slice(0, 1000) : 'The agent reported an error.');
    case 'TEXT_MESSAGE_START':
    case 'TEXT_MESSAGE_END':
      if (!identifier(event.messageId)) throw new Error('The chat event has no valid message ID.');
      break;
    case 'TEXT_MESSAGE_CONTENT':
      if (!identifier(event.messageId) || typeof event.delta !== 'string') {
        throw new Error('The chat stream contained invalid text content.');
      }
      state.messages.set(event.messageId, (state.messages.get(event.messageId) || '') + event.delta);
      state.answerVersion += 1;
      break;
    case 'TOOL_CALL_START':
      if (!identifier(event.toolCallId) || !identifier(event.toolCallName)) {
        throw new Error('The chat stream contained invalid tool progress.');
      }
      state.progress.set(event.toolCallId, event.toolCallName.slice(0, 160));
      break;
    case 'TOOL_CALL_END':
      if (!identifier(event.toolCallId)) throw new Error('The chat event has no valid tool ID.');
      state.progress.delete(event.toolCallId);
      break;
    case 'CUSTOM': {
      if (!identifier(event.name) || !Object.hasOwn(event, 'value')) {
        throw new Error('The chat stream contained an invalid custom event.');
      }
      if (['routePlan', 'statementCard', 'tripList', 'helpMedia', 'followUps'].includes(event.name)) {
        if (!identifier(event.value?.toolCallId)) {
          throw new Error('Interactive chat content is missing its tool call ID.');
        }
        upsertTool(state, event.name, event.value.toolCallId, event.value);
        break;
      }
      state.unsupportedContent = true;
      if (state.customTruncated) break;
      const serialized = JSON.stringify(event);
      const size = new TextEncoder().encode(serialized).byteLength;
      if (state.customEvents.length >= CUSTOM_LIMIT || state.customBytes + size > CUSTOM_BYTES) {
        state.customTruncated = true;
      } else {
        state.customEvents.push(JSON.parse(serialized));
        state.customBytes += size;
      }
      break;
    }
    default:
      if (!OTHER_EVENTS.has(event.type)) throw new Error('The chat stream contained an unsupported event type.');
  }
}

export function aguiAnswerParts(state) {
  return [{ kind: 'text', text: [...state.messages.values()].join('\n\n') }];
}

export function aguiNotice(state) {
  const progress = [...state.progress.values()].map((name) => `Using ${name}...`);
  if (state.unsupportedContent) {
    progress.push('Additional interactive content is not yet supported.');
    if (state.customTruncated) progress.push('The per-turn interactive-event retention limit was reached.');
  }
  return progress.join(' ');
}

export async function readAGUIStream(body, state, onUpdate) {
  // SSE framing is shared; A2A envelopes are never used by the AG-UI adapter.
  await readEventStream(body, (event) => {
    applyAGUIEvent(state, event);
    onUpdate();
    return state.closed;
  }, () => {
    state.closed = true;
    state.outcome = 'completed';
    state.progress.clear();
    onUpdate();
    return true;
  });
  if (!state.closed) {
    if (state.progress.size
      || (!state.messages.size && !state.tools.size && !state.unsupportedContent)) {
      throw new Error('The chat response ended before an answer was available.');
    }
    state.closed = true;
    state.outcome = 'completed';
  }
}

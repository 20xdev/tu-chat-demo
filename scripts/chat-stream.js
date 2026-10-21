import { mergeResponseParts } from './chat-response.js';

const STOP_STATES = new Set([
  'completed', 'failed', 'canceled', 'rejected', 'input-required', 'auth-required',
]);

export function createChatRequest(text, contextId, token) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Chat-Access-Token': token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/stream',
      params: {
        message: {
          kind: 'message',
          messageId: crypto.randomUUID(),
          contextId,
          role: 'user',
          parts: [{ kind: 'text', text }],
        },
      },
    }),
  };
}

export function createTurnState(contextId) {
  return {
    contextId,
    taskId: null,
    provisional: [],
    artifacts: new Map(),
    tools: new Map(),
    answerVersion: 0,
    closed: false,
    outcome: null,
  };
}

function collectTools(state, parts) {
  parts.forEach((part) => {
    const tool = part?.kind === 'data' ? part.data?.toolData : null;
    if (!tool || !['routePlan', 'helpMedia', 'followUps'].includes(tool.kind)
      || typeof tool.toolUseId !== 'string' || !tool.toolUseId.trim()) return;
    const key = `${tool.kind}:${tool.toolUseId}`;
    const previous = state.tools.get(key);
    if (!previous || JSON.stringify(previous.value) !== JSON.stringify(tool.value)) {
      state.tools.set(key, { kind: tool.kind, value: tool.value });
    }
  });
}

function contentParts(state, parts) {
  if (!Array.isArray(parts)) throw new Error('Invalid response parts');
  collectTools(state, parts);
  return parts.filter((part) => part?.kind !== 'data');
}

export function applyTurnEvent(state, envelope) {
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid chat event');
  if (envelope.error) throw new Error('Chat service reported an error');
  const { result } = envelope;
  if (!result || typeof result !== 'object') throw new Error('Missing chat result');
  if (result.contextId && result.contextId !== state.contextId) return;
  if (result.status?.message?.contextId
    && result.status.message.contextId !== state.contextId) return;
  const taskId = result.kind === 'task' ? result.id : result.taskId;
  if (taskId && state.taskId && taskId !== state.taskId) return;
  if (taskId) state.taskId = taskId;

  const reply = result.kind === 'message' ? result : result.status?.message;
  if (reply?.role !== 'user' && reply?.parts) {
    const parts = contentParts(state, reply.parts);
    if (parts.length) {
      state.provisional = mergeResponseParts(
        state.provisional,
        parts,
        result.kind === 'status-update' && result.status?.state === 'working',
      );
      state.answerVersion += 1;
    }
  }
  const artifacts = result.artifact ? [result.artifact] : (result.artifacts || []);
  if (!Array.isArray(artifacts)) throw new Error('Invalid chat artifacts');
  artifacts.forEach((artifact) => {
    const parts = contentParts(state, artifact.parts || []);
    const key = artifact.artifactId || 'artifact';
    if (parts.length || state.artifacts.has(key)) {
      const previous = state.artifacts.get(key);
      state.artifacts.set(key, {
        parts: mergeResponseParts(previous?.parts || [], parts, result.append === true),
        lastChunk: result.lastChunk === true,
      });
      state.answerVersion += 1;
    }
  });
  const outcome = result.status?.state;
  if (outcome) state.outcome = outcome;
  if (result.kind === 'message') {
    state.outcome = 'completed';
    state.closed = true;
  } else if (STOP_STATES.has(outcome) || result.final === true) {
    state.closed = true;
  }
  if (['failed', 'canceled', 'rejected'].includes(outcome)) {
    throw new Error('Chat task did not complete');
  }
}

export function answerParts(state) {
  return state.artifacts.size
    ? [...state.artifacts.values()].flatMap((artifact) => artifact.parts)
    : state.provisional;
}

export function turnFinished(state) {
  return state.closed && ['completed', 'input-required', 'auth-required'].includes(state.outcome);
}

export async function readA2AStream(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lines = [];
  let ended = false;
  let stopped = false;
  function dispatch() {
    if (!lines.length) return false;
    const data = lines.join('\n');
    lines = [];
    // Tolerate older fixtures, but never treat this non-A2A marker as task completion.
    if (data === '[DONE]') return false;
    return onEvent(JSON.parse(data)) === true;
  }
  function line(value) {
    if (!value) return dispatch();
    if (value.startsWith('data:')) lines.push(value.slice(5).replace(/^ /, ''));
    return false;
  }
  try {
    while (!ended && !stopped) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      ended = chunk.done;
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !ended });
      let match = buffer.match(/[\r\n]/);
      while (match && !stopped) {
        const { index } = match;
        if (!ended && buffer[index] === '\r' && index === buffer.length - 1) break;
        const length = buffer.slice(index, index + 2) === '\r\n' ? 2 : 1;
        stopped = line(buffer.slice(0, index));
        buffer = buffer.slice(index + length);
        match = buffer.match(/[\r\n]/);
      }
    }
    if (ended && !stopped) {
      if (buffer) stopped = line(buffer);
      if (!stopped) dispatch();
    }
  } finally {
    try {
      if (!ended) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

function validPosition(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

export function parseRoutePlan(value) {
  if (value?.ok !== true) return { error: 'Route information is unavailable.' };
  const validPlace = (place) => typeof place?.label === 'string' && place.label.trim()
    && validPosition(place.position);
  if (!validPlace(value.origin) || !validPlace(value.destination)
    || !Array.isArray(value.segments) || !value.segments.length
    || !value.segments.every((segment) => typeof segment?.tolled === 'boolean'
      && Array.isArray(segment.points) && segment.points.length >= 2
      && segment.points.every(validPosition))) {
    return { error: 'The supplied route geometry is incomplete or invalid.' };
  }
  const metric = (key) => (typeof value[key] === 'number'
    && Number.isFinite(value[key]) && value[key] >= 0 ? value[key] : null);
  return {
    origin: value.origin,
    destination: value.destination,
    segments: value.segments,
    distance: metric('distance_km'),
    duration: metric('duration_minutes'),
    tolledDistance: metric('tolled_distance_km'),
    untolledDistance: metric('untolled_distance_km'),
    toll: metric('toll_total'),
    currency: typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
      ? value.currency : null,
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.filter((assumption) => typeof assumption === 'string' && assumption.trim())
      : [],
  };
}

export function routeGeometry(route) {
  const latLng = (position) => [position[1], position[0]];
  return {
    origin: latLng(route.origin.position),
    destination: latLng(route.destination.position),
    segments: route.segments.map((segment) => ({
      tolled: segment.tolled, points: segment.points.map(latLng),
    })),
    bounds: [
      latLng(route.origin.position),
      latLng(route.destination.position),
      ...route.segments.flatMap((segment) => segment.points.map(latLng)),
    ],
  };
}

export function followUpOptions(value) {
  if (!Array.isArray(value?.options)) return [];
  return [...new Set(value.options.filter((option) => typeof option === 'string')
    .map((option) => option.trim()).filter(Boolean))];
}

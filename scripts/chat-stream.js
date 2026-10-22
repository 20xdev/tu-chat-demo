import { mergeResponseParts } from './chat-response.js';

const STOP_STATES = new Set([
  'completed', 'failed', 'canceled', 'rejected', 'input-required', 'auth-required',
]);

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

export function upsertTool(state, kind, id, value) {
  const key = `${kind}:${id}`;
  const previous = state.tools.get(key);
  if (!previous || JSON.stringify(previous.value) !== JSON.stringify(value)) {
    state.tools.set(key, { kind, value });
  }
}

function collectTools(state, parts) {
  parts.forEach((part) => {
    const tool = part?.kind === 'data' ? part.data?.toolData : null;
    if (!tool || !['routePlan', 'helpMedia', 'followUps'].includes(tool.kind)
      || typeof tool.toolUseId !== 'string' || !tool.toolUseId.trim()) return;
    upsertTool(state, tool.kind, tool.toolUseId, tool.value);
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

export async function readEventStream(body, onEvent, onDone = () => false) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lines = [];
  let ended = false;
  let stopped = false;
  let eventSize = 0;
  function dispatch() {
    if (!lines.length) return false;
    const data = lines.join('\n');
    lines = [];
    eventSize = 0;
    // Only callers that recognise this sentinel may stop the stream.
    if (data === '[DONE]') return onDone() === true;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('The chat stream contained invalid JSON.');
    }
    return onEvent(event) === true;
  }
  function line(value) {
    if (!value) return dispatch();
    if (value.startsWith('data:')) {
      eventSize += value.length;
      if (eventSize > 16 * 1024 * 1024) throw new Error('The chat event exceeds the size limit.');
      lines.push(value.slice(5).replace(/^ /, ''));
    }
    return false;
  }
  try {
    while (!ended && !stopped) {
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      ended = chunk.done;
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !ended });
      if (buffer.length > 16 * 1024 * 1024) throw new Error('The chat event exceeds the size limit.');
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

export const readA2AStream = readEventStream;

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
  const currency = typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency)
    ? value.currency : null;
  let incompleteDetails = false;
  const tolls = Array.isArray(value.tolls) ? value.tolls.map((toll) => {
    if (typeof toll?.name !== 'string' || !toll.name.trim()
      || typeof toll.amount !== 'number' || !Number.isFinite(toll.amount) || toll.amount < 0
      || (toll.currency !== undefined
        && (typeof toll.currency !== 'string' || !/^[A-Z]{3}$/.test(toll.currency)))) return null;
    const system = typeof toll.system === 'string' && toll.system.trim()
      ? toll.system.trim() : null;
    const estimate = typeof toll.estimate === 'boolean' ? toll.estimate : null;
    const paymentMethods = Array.isArray(toll.payment_methods)
      ? toll.payment_methods.filter((method) => typeof method === 'string' && method.trim())
        .map((method) => method.trim()) : [];
    if ((toll.system !== undefined && system === null)
      || (toll.estimate !== undefined && estimate === null)
      || (toll.payment_methods !== undefined && (!Array.isArray(toll.payment_methods)
        || paymentMethods.length !== toll.payment_methods.length))) incompleteDetails = true;
    return {
      name: toll.name.trim(),
      amount: toll.amount,
      currency: toll.currency ?? currency,
      system,
      estimate,
      paymentMethods,
    };
  }).filter(Boolean) : [];
  const paymentSites = Array.isArray(value.toll_payment_sites)
    ? value.toll_payment_sites.filter((site) => typeof site?.name === 'string'
      && site.name.trim() && validPosition(site.position))
      .map((site) => ({ name: site.name.trim(), position: site.position })) : [];
  const tollRoads = Array.isArray(value.toll_roads) ? value.toll_roads.map((road) => {
    if (typeof road?.name !== 'string' || !road.name.trim()
      || (road.number !== undefined
        && (typeof road.number !== 'string' || !road.number.trim()))) return null;
    return `${road.name.trim()}${road.number ? ` (${road.number.trim()})` : ''}`;
  }).filter(Boolean) : [];
  return {
    origin: value.origin,
    destination: value.destination,
    segments: value.segments,
    distance: metric('distance_km'),
    duration: metric('duration_minutes'),
    tolledDistance: metric('tolled_distance_km'),
    untolledDistance: metric('untolled_distance_km'),
    toll: metric('toll_total'),
    currency,
    tolls,
    tollRoads,
    paymentSites,
    incompleteDetails: incompleteDetails || (value.tolls !== undefined
      && (!Array.isArray(value.tolls) || tolls.length !== value.tolls.length))
      || (value.toll_roads !== undefined
        && (!Array.isArray(value.toll_roads) || tollRoads.length !== value.toll_roads.length))
      || (value.toll_payment_sites !== undefined && (!Array.isArray(value.toll_payment_sites)
        || paymentSites.length !== value.toll_payment_sites.length)),
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
    paymentSites: route.paymentSites.map((site) => ({
      name: site.name, position: latLng(site.position),
    })),
    bounds: [
      latLng(route.origin.position),
      latLng(route.destination.position),
      ...route.segments.flatMap((segment) => segment.points.map(latLng)),
      ...route.paymentSites.map((site) => latLng(site.position)),
    ],
  };
}

export function followUpOptions(value) {
  if (!Array.isArray(value?.options)) return [];
  return [...new Set(value.options.filter((option) => typeof option === 'string')
    .map((option) => option.trim()).filter(Boolean))];
}

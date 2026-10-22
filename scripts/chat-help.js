import { followUpOptions } from './chat-stream.js';

export function parseHelpMedia(value) {
  const isQuestion = value?.status === 'question';
  const isOutcome = value?.status === 'outcome';
  const isDiagnostic = isQuestion || isOutcome;
  const steps = Array.isArray(value?.steps) ? value.steps : [];
  const validSteps = steps.filter((step) => typeof step === 'string' && step.trim());
  const warnings = [];
  if (!isDiagnostic && value?.found !== true) warnings.push('Help media is unavailable for this request.');
  if (!isDiagnostic && !validSteps.length) warnings.push('No valid written instructions were supplied.');
  else if (validSteps.length !== steps.length) warnings.push('Some invalid help steps were omitted.');
  if (isDiagnostic && Object.hasOwn(value, 'steps') && !Array.isArray(value.steps)) {
    warnings.push('The supplied help instructions are invalid.');
  }
  if ((isDiagnostic ? Object.hasOwn(value, 'media') : value?.found === true)
    && !Array.isArray(value.media)) {
    warnings.push('No media references were supplied.');
  }
  const question = typeof value?.question === 'string' ? value.question.trim() : '';
  const options = isQuestion ? followUpOptions(value) : [];
  const accountFields = [];
  let accountSummary = '';
  if (isQuestion) {
    if (!question) warnings.push('No valid help question was supplied.');
    if (!options.length) warnings.push('No valid answer options were supplied.');
    else if (value.options.some((option) => typeof option !== 'string' || !option.trim())) {
      warnings.push('Some invalid answer options were omitted.');
    }
    const account = value.account_check;
    if (Object.hasOwn(value, 'account_check')) {
      if (!account || typeof account !== 'object' || Array.isArray(account)) {
        warnings.push('The supplied account check is invalid.');
      } else {
        let invalid = false;
        [
          ['tag_number_ending', 'Tag ending'],
          ['status', 'Account status'],
          ['last_known_plate', 'Last known plate'],
          ['last_detected', 'Last detected'],
          ['trips_matched_by_plate_since', 'Trips matched by plate since'],
        ].forEach(([key, label]) => {
          if (!Object.hasOwn(account, key)) return;
          const field = account[key];
          const valid = key === 'trips_matched_by_plate_since'
            ? Number.isSafeInteger(field) && field >= 0
            : typeof field === 'string' && field.trim();
          if (valid) accountFields.push([label, String(field)]);
          else invalid = true;
        });
        if (Object.hasOwn(account, 'summary')) {
          if (typeof account.summary === 'string' && account.summary.trim()) {
            accountSummary = account.summary;
          } else invalid = true;
        }
        if (invalid) warnings.push('Some account-check details are incomplete or invalid.');
      }
    }
  }
  const outcome = typeof value?.outcome === 'string' ? value.outcome.trim() : '';
  const advice = typeof value?.advice === 'string' ? value.advice.trim() : '';
  let offer = null;
  if (isOutcome) {
    if (!outcome) warnings.push('No valid tag-check outcome was supplied.');
    if (!advice) warnings.push('No valid tag-check advice was supplied.');
    if (Object.hasOwn(value, 'offer')) {
      const supplied = value.offer;
      if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
        warnings.push('The supplied offer is invalid.');
      } else {
        offer = {};
        ['action', 'item', 'prompt'].forEach((key) => {
          offer[key] = typeof supplied[key] === 'string' ? supplied[key].trim() : '';
        });
        if (Object.values(offer).some((field) => !field)) {
          warnings.push('Some offer details are incomplete or invalid.');
        }
      }
    }
  }
  const defaultTitle = isDiagnostic ? 'Tag health check' : 'Help instructions';
  return {
    isQuestion,
    isOutcome,
    outcome,
    advice,
    offer,
    question,
    options,
    accountFields,
    accountSummary,
    found: value?.found === true,
    title: typeof value?.title === 'string' && value.title.trim()
      ? value.title : defaultTitle,
    steps: validSteps,
    media: Array.isArray(value?.media) ? value.media : [],
    warnings,
  };
}

function hasUnsafeURLSyntax(value) {
  return value.startsWith('//')
    || [...value].some((character) => character === '\\'
      || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
    || /%(?:2e|2f|5c|25)|%(?![0-9a-f]{2})/i.test(value);
}

function imageURL(source, assetBase) {
  if (typeof source !== 'string' || !source.trim()) {
    return { error: 'The illustration has no valid image source.' };
  }
  const value = source.trim();
  if (hasUnsafeURLSyntax(value)) {
    return { error: 'The illustration URL is not permitted.' };
  }
  if (typeof assetBase !== 'string' || !assetBase.trim()) {
    return { error: 'Help-image hosting has not been configured.' };
  }
  if (hasUnsafeURLSyntax(assetBase)) {
    return { error: 'The configured help-image asset base is invalid.' };
  }
  let base;
  let url;
  try {
    base = new URL(assetBase);
    if (base.pathname === '/') base.pathname = '/help/tags/';
    url = new URL(value, base);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { error: 'The illustration URL or configured asset base is invalid.' };
  }
  const localDevelopment = base.protocol === 'http:'
    && base.origin === new URL(import.meta.url).origin
    && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !localDevelopment)
    || base.username || base.password || base.search || base.hash
    || !base.pathname.endsWith('/')) {
    return { error: 'Help-image hosting requires a trusted HTTPS asset directory.' };
  }
  if (url.protocol !== base.protocol || url.username || url.password || url.search || url.hash
    || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    return { error: 'The illustration URL is outside the approved asset location.' };
  }
  return { url: url.href };
}

export function resolveHelpMediaURL(media, assetBase) {
  if (media?.type === 'image') return imageURL(media.src, assetBase);
  if (media?.type === 'video') {
    if (typeof media.youtubeId !== 'string' || media.youtubeId.length !== 11
      || !/^[A-Za-z0-9_-]{11}$/.test(media.youtubeId)) {
      return { error: 'The video reference has an invalid YouTube identifier.' };
    }
    return { url: `https://www.youtube.com/watch?v=${media.youtubeId}` };
  }
  return { error: 'This media reference is invalid or unsupported.' };
}

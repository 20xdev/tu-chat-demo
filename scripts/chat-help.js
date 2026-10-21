export function parseHelpMedia(value) {
  const steps = Array.isArray(value?.steps) ? value.steps : [];
  const validSteps = steps.filter((step) => typeof step === 'string' && step.trim());
  const warnings = [];
  if (value?.found !== true) warnings.push('Help media is unavailable for this request.');
  if (!validSteps.length) warnings.push('No valid written instructions were supplied.');
  else if (validSteps.length !== steps.length) warnings.push('Some invalid help steps were omitted.');
  if (value?.found === true && !Array.isArray(value.media)) {
    warnings.push('No media references were supplied.');
  }
  return {
    found: value?.found === true,
    title: typeof value?.title === 'string' && value.title.trim()
      ? value.title : 'Help instructions',
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
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
    || !base.pathname.endsWith('/')) {
    return { error: 'Help-image hosting requires a trusted HTTPS asset directory.' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
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

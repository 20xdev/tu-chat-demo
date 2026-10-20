const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml',
]);

class ImageSourceError extends Error {}

export function mergeResponseParts(previous, incoming, append) {
  if (!Array.isArray(incoming)) throw new Error('Invalid response parts');
  const parts = append ? [...previous] : [];
  incoming.forEach((part) => {
    const last = parts[parts.length - 1];
    if (part?.kind === 'text' && typeof part.text === 'string'
      && last?.kind === 'text' && typeof last.text === 'string') {
      parts[parts.length - 1] = { ...last, text: last.text + part.text };
    } else {
      parts.push(part);
    }
  });
  return parts;
}

function imageType(value) {
  const type = typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  return type === 'image/jpg' ? 'image/jpeg' : type;
}

function decodeBase64(value) {
  const encoded = value.replace(/\s/g, '');
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw new ImageSourceError('Image exceeds the 5 MiB inline limit.');
  }
  let binary;
  try {
    binary = atob(encoded);
  } catch (error) {
    if (error.name !== 'InvalidCharacterError') throw error;
    throw new ImageSourceError('Invalid base64 image.');
  }
  if (!binary.length) throw new ImageSourceError('Empty image.');
  if (binary.length > MAX_IMAGE_BYTES) {
    throw new ImageSourceError('Image exceeds the 5 MiB inline limit.');
  }
  return binary;
}

function fallback(label, reason) {
  const element = document.createElement('span');
  element.className = 'chat-image-fallback';
  element.textContent = `${label || 'Image unavailable'}: ${reason}`;
  return element;
}

export function createResponseRenderer(marked, DOMPurify) {
  function svgSource(source) {
    if (new TextEncoder().encode(source).length > MAX_IMAGE_BYTES) {
      throw new ImageSourceError('SVG exceeds the 5 MiB inline limit.');
    }
    const xml = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') {
      throw new ImageSourceError('Invalid SVG.');
    }
    const clean = DOMPurify.sanitize(source, {
      ALLOWED_TAGS: [
        'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
        'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc',
        'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'marker',
      ],
      ALLOWED_ATTR: [
        'xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2',
        'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform',
        'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
        'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
        'stroke-miterlimit', 'opacity', 'id', 'href', 'xlink:href', 'clip-path',
        'clip-rule', 'mask', 'maskunits', 'maskcontentunits', 'preserveaspectratio',
        'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform',
        'spreadmethod', 'fx', 'fy', 'fr', 'patternunits', 'patterncontentunits',
        'patterntransform', 'markerwidth', 'markerheight', 'markerunits',
        'refx', 'refy', 'orient', 'marker-start', 'marker-mid', 'marker-end',
        'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
        'dx', 'dy', 'textlength', 'lengthadjust', 'vector-effect',
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    const svg = clean.firstElementChild;
    if (svg?.localName !== 'svg'
      || !svg.querySelector('path, rect, circle, ellipse, line, polyline, polygon, text, use')) {
      throw new ImageSourceError('SVG has no supported artwork.');
    }
    [svg, ...svg.querySelectorAll('*')].forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const { name, value } = attribute;
        // SVG resources may reference local definitions, never external documents.
        if ((['href', 'xlink:href'].includes(name) && !/^#[\w:.-]+$/.test(value))
          || (/url\s*\(/i.test(value) && !/^url\(\s*#[\w:.-]+\s*\)$/i.test(value))) {
          element.removeAttribute(name);
        }
      });
    });
    svg.setAttribute('xmlns', SVG_NAMESPACE);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  }

  function dataSource(source) {
    const match = source.match(/^data:([^,]*),([\s\S]*)$/i);
    if (!match) throw new ImageSourceError('Invalid image data URL.');
    const type = imageType(match[1]);
    if (!IMAGE_TYPES.has(type)) throw new ImageSourceError('Unsupported image type.');
    const base64 = /;base64$/i.test(match[1]);
    if (type !== 'image/svg+xml') {
      if (!base64) throw new ImageSourceError('Raster image data must be base64 encoded.');
      decodeBase64(match[2]);
      return `data:${type};base64,${match[2].replace(/\s/g, '')}`;
    }
    let svg;
    try {
      svg = base64
        ? new TextDecoder('utf-8', { fatal: true })
          .decode(Uint8Array.from(decodeBase64(match[2]), (character) => character.charCodeAt(0)))
        : decodeURIComponent(match[2]);
    } catch (error) {
      if (!(error instanceof URIError) && !(error instanceof TypeError)) throw error;
      throw new ImageSourceError('Invalid SVG encoding.');
    }
    return svgSource(svg);
  }

  function image(source, label) {
    try {
      if (typeof source !== 'string' || !source.trim()) {
        throw new ImageSourceError('Missing image source.');
      }
      const value = source.trim();
      let safeSource;
      if (/^data:/i.test(value)) {
        safeSource = dataSource(value);
      } else {
        let url;
        try {
          url = new URL(value, window.location.href);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          throw new ImageSourceError('Invalid image URL.');
        }
        if (!['https:', 'http:'].includes(url.protocol)) {
          throw new ImageSourceError('Unsupported image URL protocol.');
        }
        safeSource = url.href;
      }
      const element = document.createElement('img');
      element.alt = typeof label === 'string' ? label : 'Image';
      element.loading = 'lazy';
      element.decoding = 'async';
      element.referrerPolicy = 'no-referrer';
      element.addEventListener('error', () => {
        element.replaceWith(fallback(element.alt, 'Image could not be loaded.'));
      }, { once: true });
      element.src = safeSource;
      return element;
    } catch (error) {
      if (!(error instanceof ImageSourceError)) throw error;
      return fallback(label, error.message);
    }
  }

  function markdown(text) {
    const template = document.createElement('template');
    template.innerHTML = marked.parse(text, { breaks: true });
    template.content.querySelectorAll('svg').forEach((svg) => {
      const placeholder = document.createElement('img');
      placeholder.alt = svg.querySelector('title')?.textContent || 'SVG image';
      placeholder.setAttribute('src', `data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}`);
      svg.replaceWith(placeholder);
    });
    const clean = DOMPurify.sanitize(template.innerHTML, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
        'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
      ],
      ALLOWED_ATTR: ['href', 'title', 'start', 'src', 'alt'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    clean.querySelectorAll('img').forEach((element) => {
      const replacement = image(element.getAttribute('src'), element.alt);
      if (element.title) replacement.title = element.title;
      element.replaceWith(replacement);
    });
    return clean;
  }

  function fileImage(file) {
    const label = typeof file?.name === 'string' ? file.name : 'Image attachment';
    const type = imageType(file?.mimeType);
    if (!file || (type && !IMAGE_TYPES.has(type))) {
      return fallback(label, 'Unsupported image attachment.');
    }
    if (typeof file.uri === 'string' && file.bytes === undefined) return image(file.uri, label);
    if (typeof file.bytes === 'string' && file.uri === undefined && IMAGE_TYPES.has(type)) {
      return image(`data:${type};base64,${file.bytes}`, label);
    }
    return fallback(label, 'Expected an image URI or base64 bytes with an image MIME type.');
  }

  return (parts) => {
    const fragment = document.createDocumentFragment();
    parts.forEach((part) => {
      if (part?.kind === 'text' && typeof part.text === 'string') {
        fragment.append(markdown(part.text));
      } else if (part?.kind === 'file') {
        fragment.append(fileImage(part.file));
      } else {
        fragment.append(fallback('Unsupported response content', 'Expected text or an image file.'));
      }
    });
    return fragment;
  };
}

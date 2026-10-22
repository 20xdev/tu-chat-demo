import { getMetadata, loadCSS } from './aem.js';
import { parseHelpMedia, resolveHelpMediaURL } from './chat-help.js';
import { followUpOptions, parseRoutePlan, routeGeometry } from './chat-stream.js';

let leaflet;

function loadLeaflet() {
  if (!leaflet) {
    const moduleURL = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm';
    const styleURL = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    leaflet = Promise.all([
      import(moduleURL),
      loadCSS(styleURL).catch((error) => {
        document.querySelector(`head > link[href="${styleURL}"]`)?.remove();
        throw error;
      }),
    ]).then(([module]) => module.default).catch((error) => {
      leaflet = undefined;
      throw error;
    });
  }
  return leaflet;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function routeView(value, host) {
  const route = parseRoutePlan(value);
  let map;
  let observer;
  let disposed = false;
  const dispose = () => {
    disposed = true;
    observer?.disconnect();
    map?.remove();
  };
  if (route.error) {
    host.append(element('p', 'chat-tool-fallback', route.error));
    return dispose;
  }
  host.classList.add('chat-route');
  host.classList.toggle('chat-route-priced', route.toll !== null);
  const number = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 });
  function cost(amount, currency) {
    return currency
      ? new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount)
      : `${new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(amount)} (currency not supplied)`;
  }
  const canvas = element('div', 'chat-route-map');
  canvas.setAttribute('role', 'region');
  canvas.setAttribute('aria-label', `Route map from ${route.origin.label} to ${route.destination.label}`);
  const details = element('div', 'chat-route-details');
  details.append(element('p', 'chat-route-places', `${route.origin.label} \u2192 ${route.destination.label}`));
  const tripMetrics = [
    route.distance !== null ? `${number.format(route.distance)} km` : null,
    route.duration !== null ? `${number.format(route.duration)} min` : null,
  ].filter(Boolean);
  if (tripMetrics.length) {
    details.append(element('p', 'chat-route-trip-meta', tripMetrics.join(' \u00b7 ')));
  }
  if (route.tolls.length || route.toll !== null) {
    const summary = element('dl', 'chat-route-summary');
    route.tolls.forEach((toll) => {
      const name = element('dt', 'chat-route-toll-name', toll.name);
      const metadata = [
        toll.system ? `System: ${toll.system}` : null,
        toll.currency ? `Currency: ${toll.currency}` : null,
        toll.estimate !== null ? `Estimated: ${toll.estimate ? 'Yes' : 'No'}` : null,
        toll.paymentMethods.length ? `Payment methods: ${toll.paymentMethods.join(', ')}` : null,
      ].filter(Boolean);
      if (metadata.length) {
        name.append(element('small', 'chat-route-toll-meta', metadata.join(' \u00b7 ')));
      }
      summary.append(
        name,
        element('dd', '', cost(toll.amount, toll.currency)),
      );
    });
    if (route.toll !== null) {
      summary.append(
        element('dt', 'chat-route-total-label', 'Toll'),
        element('dd', 'chat-route-total', cost(route.toll, route.currency)),
      );
    }
    details.append(summary);
  }
  if (route.incompleteDetails) {
    details.append(element('p', 'chat-tool-fallback', 'Some toll details could not be displayed.'));
  }
  const legend = element('p', 'chat-route-legend');
  legend.id = `chat-route-legend-${crypto.randomUUID()}`;
  const tolledLabel = route.tolledDistance !== null
    ? `${number.format(route.tolledDistance)} km on ${route.tollRoads.join(', ') || 'tolled roads'}`
    : `Tolled roads${route.tollRoads.length ? `: ${route.tollRoads.join(', ')}` : ''}`;
  const untolledLabel = route.untolledDistance !== null
    ? `${number.format(route.untolledDistance)} km on untolled roads` : 'Untolled roads';
  const tolled = element('span', 'chat-route-tolled', tolledLabel);
  const untolled = element('span', 'chat-route-untolled', untolledLabel);
  tolled.setAttribute('aria-label', `Solid green line: ${tolledLabel}`);
  untolled.setAttribute('aria-label', `Dashed gray line: ${untolledLabel}`);
  legend.append(
    tolled,
    untolled,
  );
  if (route.paymentSites.length) {
    legend.append(element('span', 'chat-route-payment', 'Toll payment sites'));
  }
  canvas.setAttribute('aria-describedby', legend.id);
  const status = element('p', 'chat-route-status', 'Loading route map...');
  status.setAttribute('role', 'status');
  details.append(legend);
  if (route.paymentSites.length) {
    const sites = element('div', 'chat-route-payment-sites');
    sites.append(element('h4', 'chat-route-payment-title', 'Toll payment sites'));
    const list = element('ul', 'chat-route-payment-list');
    route.paymentSites.forEach((site) => {
      const item = element('li', '', site.name);
      item.append(element(
        'small',
        'chat-route-site-position',
        `Location: ${site.position[1]}, ${site.position[0]} (latitude, longitude)`,
      ));
      list.append(item);
    });
    sites.append(list);
    details.append(sites);
  }
  const notes = element('div', 'chat-route-notes');
  if (route.assumptions.length) {
    notes.append(element('p', 'chat-route-assumptions', route.assumptions.join(' \u00b7 ')));
  }
  notes.append(element('p', 'chat-route-estimate', 'Estimate only. Not a guaranteed live price.'));
  details.append(notes, status);
  host.append(canvas, details);
  loadLeaflet().then((L) => {
    if (disposed || !host.isConnected) return;
    const geometry = routeGeometry(route);
    map = L.map(canvas, { scrollWheelZoom: false, zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(map);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    tiles.on('tileerror', () => {
      status.classList.remove('chat-route-status-ready');
      status.textContent = 'Map tiles could not be loaded. Route lines and the written summary remain available.';
    });
    geometry.segments.forEach((segment) => {
      L.polyline(segment.points, {
        color: segment.tolled ? '#00a650' : '#5b5b5b',
        weight: 5,
        dashArray: segment.tolled ? null : '8 6',
        smoothFactor: 0,
        interactive: false,
      }).addTo(map);
    });
    geometry.paymentSites.forEach((site) => {
      const label = `Toll payment site: ${site.name}`;
      const marker = L.circleMarker(site.position, {
        radius: 5, color: '#00843d', weight: 2, fillColor: '#fff', fillOpacity: 1,
      }).bindTooltip(element('span', '', label));
      marker.on('add', () => {
        marker.getElement()?.setAttribute('role', 'img');
        marker.getElement()?.setAttribute('aria-label', label);
      });
      marker.addTo(map);
    });
    [
      [geometry.origin, `Origin: ${route.origin.label}`, '#353535'],
      [geometry.destination, `Destination: ${route.destination.label}`, '#00a650'],
    ].forEach(([position, label, color]) => {
      const marker = L.circleMarker(position, {
        radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1,
      })
        .bindTooltip(element('span', '', label));
      marker.on('add', () => {
        marker.getElement()?.setAttribute('role', 'img');
        marker.getElement()?.setAttribute('aria-label', label);
      });
      marker.addTo(map);
    });
    let fittedWidth = 0;
    let fittedHeight = 0;
    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height || (width === fittedWidth && height === fittedHeight)) return;
      map.invalidateSize();
      map.fitBounds(geometry.bounds, { padding: [20, 20], maxZoom: 16, animate: false });
      fittedWidth = width;
      fittedHeight = height;
    };
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    status.classList.add('chat-route-status-ready');
    status.textContent = 'Map: OpenStreetMap. Use the map controls or keyboard to explore.';
  }).catch(() => {
    if (disposed) return;
    observer?.disconnect();
    map?.remove();
    map = undefined;
    canvas.hidden = true;
    status.classList.remove('chat-route-status-ready');
    status.textContent = 'The map could not be loaded. The written route summary remains available.';
  });
  return dispose;
}

function helpView(value, host, assetBase) {
  const help = parseHelpMedia(value);
  const cleanups = [];
  host.classList.add('chat-help');
  host.append(element('h3', '', help.title));
  help.warnings.forEach((warning) => host.append(element('p', 'chat-tool-fallback', warning)));
  if (help.steps.length) {
    const steps = element('ol', 'chat-help-steps');
    help.steps.forEach((step) => steps.append(element('li', '', step)));
    host.append(steps);
  }
  if (help.found && help.media.length) {
    const media = element('div', 'chat-help-media');
    help.media.forEach((entry) => {
      const figure = element('figure', 'chat-help-figure');
      const caption = typeof entry?.caption === 'string' && entry.caption.trim()
        ? entry.caption : '';
      const imageAlt = typeof entry?.alt === 'string' && entry.alt.trim()
        ? entry.alt : (caption || 'Help illustration');
      const resolved = resolveHelpMediaURL(entry, assetBase);
      if (resolved.error) {
        const description = entry?.type === 'image' ? `${imageAlt}: ` : '';
        figure.append(element('p', 'chat-tool-fallback', `${description}${resolved.error}`));
      } else if (entry.type === 'image') {
        const frame = element('div', 'chat-help-image-frame');
        const image = element('img', 'chat-help-illustration');
        image.alt = imageAlt;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.width = 640;
        image.height = 360;
        const unavailable = () => frame.replaceWith(element('p', 'chat-tool-fallback', `${image.alt}: Illustration could not be loaded.`));
        image.addEventListener('error', unavailable, { once: true });
        image.src = resolved.url;
        frame.append(image);
        figure.append(frame);
        cleanups.push(() => {
          image.removeEventListener('error', unavailable);
          image.removeAttribute('src');
        });
      } else {
        const title = typeof entry.title === 'string' && entry.title.trim()
          ? entry.title : 'Help video';
        const link = element('a', 'chat-help-video-link', `${title} (opens YouTube in a new tab)`);
        link.href = resolved.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        figure.append(link, element(
          'p',
          'chat-help-video-note',
          'External video reference; availability has not been verified.',
        ));
      }
      if (caption) figure.append(element('figcaption', '', caption));
      media.append(figure);
    });
    host.append(media);
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

export default function createToolViews(
  container,
  onFollowUp,
  helpAssetBase = getMetadata('chat-help-asset-base')
    || new URL('../help/tags/', import.meta.url).href,
) {
  const views = new Map();
  let busy = false;
  let disposed = false;
  return {
    update(tools) {
      if (disposed) return;
      tools.forEach((tool, key) => {
        if (views.get(key)?.tool === tool) return;
        const previous = views.get(key);
        previous?.dispose();
        const host = element('section', 'chat-tool');
        let dispose = () => {};
        if (tool.kind === 'routePlan') dispose = routeView(tool.value, host);
        if (tool.kind === 'helpMedia') dispose = helpView(tool.value, host, helpAssetBase);
        if (tool.kind === 'followUps') {
          host.classList.add('chat-followups');
          host.setAttribute('aria-label', 'Suggested follow-up questions');
          const options = followUpOptions(tool.value);
          if (!options.length) {
            host.append(element('p', 'chat-tool-fallback', 'No valid follow-up questions were supplied.'));
          } else {
            host.append(element('h3', '', 'You could also ask'));
            options.forEach((option) => {
              const button = element('button', 'chat-followup', option);
              button.type = 'button';
              button.disabled = busy;
              button.addEventListener('click', () => {
                if (!disposed && !button.disabled) onFollowUp(option);
              });
              host.append(button);
            });
          }
        }
        if (previous) previous.host.replaceWith(host);
        else container.append(host);
        views.set(key, { tool, host, dispose });
      });
      container.hidden = !views.size;
    },
    setBusy(value) {
      busy = value;
      container.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
    },
    dispose() {
      disposed = true;
      views.forEach((view) => view.dispose());
      views.clear();
      container.replaceChildren();
    },
  };
}

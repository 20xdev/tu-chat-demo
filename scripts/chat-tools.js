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

function statementView(value, host) {
  if (value?.found !== true) {
    host.append(element('p', 'chat-tool-fallback', 'Statement information is unavailable.'));
    return;
  }
  host.classList.add('chat-statement');
  let incomplete = false;
  const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  const dates = new Intl.DateTimeFormat('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  function text(input) {
    if (input === undefined) return null;
    if (typeof input === 'string' && input.trim()) return input.trim();
    incomplete = true;
    return null;
  }
  function money(input) {
    if (input === undefined) return null;
    if (typeof input === 'number' && Number.isFinite(input)) return currency.format(input);
    incomplete = true;
    return null;
  }
  function date(input) {
    if (input === undefined || input === null) return null;
    if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const parsed = new Date(`${input}T00:00:00Z`);
      if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input) {
        return dates.format(parsed);
      }
    }
    incomplete = true;
    return null;
  }
  function balance(input) {
    if (input === undefined) return null;
    const amount = money(input?.amount_aud);
    const position = text(input?.position);
    if (amount === null) incomplete = true;
    return amount === null ? null : `${amount}${position ? ` (${position})` : ''}`;
  }
  const id = text(value.statement_id);
  const issued = date(value.statement_date);
  if (!id || !issued) incomplete = true;
  const header = element('div', 'chat-statement-header');
  const identity = element('div', 'chat-statement-identity');
  identity.append(element('h3', 'chat-statement-title', issued ? `Statement \u00b7 ${issued}` : 'Statement'));
  if (id) identity.append(element('p', 'chat-statement-id', id));
  const status = text(value.status);
  const statusFacts = element('dl', 'chat-statement-summary chat-statement-status');
  function fact(list, label, content, className = '') {
    if (content !== null && content !== undefined) {
      const row = element('div', `chat-statement-fact${className ? ` ${className}` : ''}`);
      row.append(element('dt', 'chat-statement-label', label), element('dd', 'chat-statement-value', content));
      list.append(row);
      return row;
    }
    return null;
  }
  const statusRow = fact(statusFacts, 'Status', status);
  statusRow?.lastElementChild.classList.add('chat-statement-badge');
  if (status) statusFacts.dataset.status = status.toLowerCase();
  header.append(identity, statusFacts);
  const hero = element('div', 'chat-statement-hero');
  const primary = element('dl', 'chat-statement-summary chat-statement-primary');
  const closing = balance(value.closing_balance);
  const total = money(value.total_charged_aud);
  if (closing !== null) {
    const row = fact(primary, 'Closing balance', closing);
    const amount = element('span', 'chat-statement-balance-amount', currency.format(value.closing_balance.amount_aud));
    const position = text(value.closing_balance.position);
    row.lastElementChild.replaceChildren(amount);
    if (position) row.lastElementChild.append(element('span', 'chat-statement-position', ` (${position})`));
  } else {
    fact(primary, 'Total charged', total);
  }
  const balanceBlock = element('div', 'chat-statement-balance');
  balanceBlock.append(primary, element('p', 'chat-statement-currency', 'All amounts in AUD.'));
  const schedule = element('dl', 'chat-statement-summary chat-statement-schedule');
  const from = date(value.period?.from);
  const to = date(value.period?.to);
  if (value.period !== undefined && (!from || !to)) incomplete = true;
  fact(schedule, 'Due date', date(value.due_on));
  fact(schedule, 'Paid on', date(value.paid_on));
  if (from || to) fact(schedule, 'Statement period', [from && `From ${from}`, to && `to ${to}`].filter(Boolean).join(' '));
  hero.append(balanceBlock, schedule);
  const bodyContent = element('div', 'chat-statement-body');
  const financials = element('div', 'chat-statement-financials');
  const payments = element('section', 'chat-statement-panel');
  payments.append(element('h4', 'chat-statement-subtitle', 'Balance & payments'));
  const balances = element('dl', 'chat-statement-summary');
  fact(balances, 'Opening balance', balance(value.opening_balance));
  fact(balances, 'Payments received', money(value.payments_received_aud));
  fact(balances, 'GST included', money(value.gst_included_aud));
  payments.append(balances);
  const chargesPanel = element('section', 'chat-statement-panel');
  chargesPanel.append(element('h4', 'chat-statement-subtitle', 'Charges this period'));
  const charges = element('dl', 'chat-statement-summary');
  fact(charges, 'Trip charges', money(value.trip_charges_aud));
  fact(charges, text(value.fees_and_adjustments_label) || 'Fees and adjustments', money(value.fees_and_adjustments_aud));
  fact(charges, 'Video matching fees (reported)', money(value.video_matching_fees_aud));
  fact(charges, 'Total charged', total, 'chat-statement-fact-total');
  if (value.trip_count !== undefined) {
    if (Number.isInteger(value.trip_count) && value.trip_count >= 0) fact(balances, 'Trips', String(value.trip_count));
    else incomplete = true;
  }
  chargesPanel.append(charges);
  financials.append(payments, chargesPanel);
  bodyContent.append(financials);
  host.append(header, hero, bodyContent);
  if (Array.isArray(value.lines) && value.lines.length) {
    const region = element('div', 'chat-statement-table');
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'Statement transaction details');
    region.tabIndex = 0;
    const table = element('table', 'chat-statement-lines');
    // Explicit roles preserve table semantics when mobile rows use a grid layout.
    table.setAttribute('role', 'table');
    const caption = element('caption', 'chat-statement-caption', 'Statement transactions');
    const entryCount = element('span', 'chat-statement-entry-count');
    caption.append(entryCount);
    table.append(caption);
    const head = element('thead', 'chat-statement-head');
    head.setAttribute('role', 'rowgroup');
    const headings = element('tr');
    headings.setAttribute('role', 'row');
    ['Charged', 'Details', 'Amount'].forEach((label) => {
      const cell = element('th', 'chat-statement-cell chat-statement-table-heading', label);
      cell.scope = 'col';
      cell.setAttribute('role', 'columnheader');
      headings.append(cell);
    });
    head.append(headings);
    const body = element('tbody', 'chat-statement-transactions');
    body.setAttribute('role', 'rowgroup');
    value.lines.forEach((line) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        incomplete = true;
        return;
      }
      const charged = date(line.charged);
      const description = text(line.details);
      const amount = money(line.amount_aud);
      if (!charged || !description || amount === null) incomplete = true;
      const row = element('tr', 'chat-statement-row');
      row.setAttribute('role', 'row');
      const details = element('td', 'chat-statement-cell');
      details.append(element('span', 'chat-statement-description', description || 'Details unavailable'));
      const metadata = element('div', 'chat-statement-line-metadata');
      [
        ['Type', line.type], ['Trip ID', line.trip_id], ['Start', line.start],
        ['Finish', line.finish], ['Charged by', line.by],
      ].forEach(([label, input]) => {
        const content = text(input);
        if (content) metadata.append(element('small', 'chat-statement-line-meta', `${label}: ${content}`));
      });
      details.append(metadata);
      row.append(
        element('td', 'chat-statement-cell', charged || 'Date unavailable'),
        details,
        element('td', 'chat-statement-cell', amount === null ? 'Amount unavailable' : amount),
      );
      [...row.children].forEach((cell) => cell.setAttribute('role', 'cell'));
      body.append(row);
    });
    const count = body.childElementCount;
    entryCount.textContent = ` \u00b7 ${count} ${count === 1 ? 'entry' : 'entries'}`;
    table.append(head, body);
    region.append(table);
    bodyContent.append(region);
  } else if (value.lines !== undefined && !Array.isArray(value.lines)) incomplete = true;
  if (value.trip_charges_by_tag !== undefined) {
    if (value.trip_charges_by_tag && typeof value.trip_charges_by_tag === 'object'
      && !Array.isArray(value.trip_charges_by_tag)) {
      const breakdown = element('dl', 'chat-statement-summary chat-statement-tags');
      Object.entries(value.trip_charges_by_tag).forEach(([tag, amount]) => {
        const label = text(tag);
        const charge = money(amount);
        if (label && charge !== null) fact(breakdown, label, charge);
        else incomplete = true;
      });
      if (breakdown.hasChildNodes()) {
        const section = element('section', 'chat-statement-tag-section');
        section.append(element('h4', 'chat-statement-subtitle', 'Trip charges by tag'), breakdown);
        bodyContent.append(section);
      }
    } else incomplete = true;
  }
  if (Array.isArray(value.notes)) {
    const notes = element('ul', 'chat-statement-notes');
    value.notes.forEach((input) => {
      const note = text(input);
      if (note) notes.append(element('li', '', note));
    });
    if (notes.hasChildNodes()) {
      const section = element('section', 'chat-statement-notes-panel');
      section.append(element('h4', 'chat-statement-subtitle', 'Statement notes'), notes);
      bodyContent.append(section);
    }
  } else if (value.notes !== undefined) incomplete = true;
  if (incomplete) {
    bodyContent.append(element('p', 'chat-tool-fallback', 'Some statement details could not be displayed because the supplied data is incomplete or invalid.'));
  }
}

function tripListView(value, host) {
  if (!Array.isArray(value?.trips)) {
    host.append(element('p', 'chat-tool-fallback', 'Trip information is unavailable because the supplied trip list is invalid.'));
    return;
  }
  host.classList.add('chat-trip-list');
  const heading = element('div', 'chat-trip-list-header');
  heading.append(element('h3', 'chat-trip-title', 'Trip breakdown'));
  const count = element('span', 'chat-trip-count');
  heading.append(count);
  const list = element('ol', 'chat-trip-items');
  const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
  let incomplete = false;
  value.trips.forEach((trip) => {
    if (!trip || typeof trip !== 'object' || Array.isArray(trip)) {
      incomplete = true;
      return;
    }
    function text(key) {
      if (trip[key] === undefined) return null;
      if (typeof trip[key] === 'string' && trip[key].trim()) return trip[key].trim();
      incomplete = true;
      return null;
    }
    function money(key) {
      if (typeof trip[key] === 'number' && Number.isFinite(trip[key])) {
        return currency.format(trip[key]);
      }
      incomplete = true;
      return null;
    }
    const fields = Object.fromEntries([
      'trip_id', 'date', 'start', 'finish', 'road', 'from', 'to',
      'by', 'plate', 'vehicle', 'charged', 'statement',
    ].map((key) => [key, text(key)]));
    if (!fields.trip_id || !fields.date || !fields.road || !fields.from || !fields.to) {
      incomplete = true;
    }
    const item = element('li', 'chat-trip-item');
    const top = element('div', 'chat-trip-heading');
    const route = element('div', 'chat-trip-route');
    route.append(element('strong', 'chat-trip-road', fields.road || 'Road unavailable'));
    route.append(element(
      'span',
      'chat-trip-places',
      [fields.from, fields.to].filter(Boolean).join(' \u2192 ') || 'Route details unavailable',
    ));
    const price = element('div', 'chat-trip-price');
    const detection = fields.by?.toLowerCase();
    if (detection === 'no tag detected (matched by number plate)' || /^tag ending \d+$/.test(detection || '')) {
      const badge = element('span', 'chat-trip-badge', detection.startsWith('tag') ? 'Tag' : 'Plate');
      badge.classList.toggle('chat-trip-badge-plate', !detection.startsWith('tag'));
      price.append(badge);
    }
    price.append(element('strong', 'chat-trip-total', money('total_aud') || 'Total unavailable'));
    top.append(route, price);
    const timing = [
      fields.date, fields.start && `Start: ${fields.start}`, fields.finish && `Finish: ${fields.finish}`,
    ].filter(Boolean).join(' \u00b7 ');
    const pricing = element('div', 'chat-trip-pricing');
    pricing.append(
      element('span', '', `Toll: ${money('toll_aud') || 'unavailable'}`),
      element('span', '', `Video matching fee: ${money('video_matching_fee_aud') || 'unavailable'}`),
    );
    const metadata = element('dl', 'chat-trip-metadata');
    [
      ['Trip ID', fields.trip_id], ['Charged by', fields.by],
      ['Plate', fields.plate], ['Vehicle', fields.vehicle],
      ['Charged', fields.charged], ['Statement', fields.statement],
    ].forEach(([label, content]) => {
      if (!content) return;
      const field = element('div', 'chat-trip-field');
      field.append(element('dt', '', `${label}: `), element('dd', '', content));
      metadata.append(field);
    });
    item.append(top, element('p', 'chat-trip-timing', timing), pricing, metadata);
    list.append(item);
  });
  count.textContent = `${list.childElementCount} ${list.childElementCount === 1 ? 'trip' : 'trips'} \u00b7 AUD`;
  host.append(heading, list);
  if (!value.trips.length) host.append(element('p', 'chat-trip-empty', 'No trips were returned.'));
  if (incomplete) {
    host.append(element('p', 'chat-tool-fallback', 'Some trip details could not be displayed because the supplied data is incomplete or invalid.'));
  }
}

function helpView(value, host, assetBase, addOptions) {
  const help = parseHelpMedia(value);
  const cleanups = [];
  host.classList.add('chat-help');
  host.append(element('h3', '', help.title));
  help.warnings.forEach((warning) => host.append(element('p', 'chat-tool-fallback', warning)));
  if (help.isQuestion) {
    host.classList.add('chat-help-question');
    if (help.accountFields.length || help.accountSummary) {
      const account = element('div', 'chat-help-account');
      account.append(element('h4', '', 'Account check'));
      if (help.accountSummary) account.append(element('p', 'chat-help-summary', help.accountSummary));
      if (help.accountFields.length) {
        const fields = element('dl', 'chat-help-account-fields');
        help.accountFields.forEach(([label, text]) => {
          const field = element('div', 'chat-help-account-field');
          field.append(element('dt', '', label), element('dd', '', text));
          fields.append(field);
        });
        account.append(fields);
      }
      host.append(account);
    }
    if (help.question) host.append(element('p', 'chat-help-question-text', help.question));
    if (help.options.length) {
      const choices = element('div', 'chat-help-options');
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', help.question || 'Answer options');
      cleanups.push(addOptions(choices, help.options));
      host.append(choices);
    }
  }
  if (help.isOutcome) {
    host.classList.add('chat-help-outcome');
    if (help.outcome || help.advice) {
      const result = element('div', 'chat-help-account');
      if (help.outcome) result.append(element('h4', '', help.outcome.replaceAll('_', ' ')));
      if (help.advice) result.append(element('p', 'chat-help-advice', help.advice));
      host.append(result);
    }
    if (help.offer?.item) {
      host.append(element('p', 'chat-help-offer-item', `Offered item: ${help.offer.item}`));
    }
    if (help.offer?.prompt) host.append(element('p', 'chat-help-question-text', help.offer.prompt));
  }
  if (help.steps.length) {
    const steps = element('ol', 'chat-help-steps');
    help.steps.forEach((step) => steps.append(element('li', '', step)));
    host.append(steps);
  }
  if ((help.found || help.isQuestion || help.isOutcome) && help.media.length) {
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
  function addOptions(host, options) {
    let active = true;
    options.forEach((option) => {
      const button = element('button', 'chat-followup', option);
      button.type = 'button';
      button.disabled = busy;
      button.addEventListener('click', () => {
        if (active && !disposed && !busy && !button.disabled) onFollowUp(option);
      });
      host.append(button);
    });
    return () => { active = false; };
  }
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
        if (tool.kind === 'statementCard') statementView(tool.value, host);
        if (tool.kind === 'tripList') tripListView(tool.value, host);
        if (tool.kind === 'helpMedia') dispose = helpView(tool.value, host, helpAssetBase, addOptions);
        if (tool.kind === 'followUps') {
          host.classList.add('chat-followups');
          host.setAttribute('aria-label', 'Suggested follow-up questions');
          const options = followUpOptions(tool.value);
          if (!options.length) {
            host.append(element('p', 'chat-tool-fallback', 'No valid follow-up questions were supplied.'));
          } else {
            host.append(element('h3', '', 'You could also ask'));
            dispose = addOptions(host, options);
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

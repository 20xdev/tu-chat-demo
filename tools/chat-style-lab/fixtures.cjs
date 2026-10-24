const notice = '> **LOCAL DEMO:** Fictional data for visual testing. No live traffic, account, pricing or payment information.';

exports.fixtures = {
  journey: `## A little planning. A smoother journey.

${notice}

![Illustrative route from Riverside to Garden Park. Not a real map.](/__mock/route.svg)

### Your journey at a glance

| Journey detail | Demo value |
| --- | --- |
| Route | Riverside to Garden Park |
| Vehicle | Passenger car |
| Trip type | One-way journey |

🟢 Vehicle details checked (demo)  
🟡 Choose a payment option before you go (demo)

[Compare passes](/account-and-passes) [Explore toll roads](/using-toll-roads)`,
  compare: `## Find your kind of travel.

${notice}

Compare a few fictional options side by side. These are **not actual Linkt products or prices**.

| Feature | Weekend Explorer | Everyday Traveller |
| --- | --- | --- |
| Best suited to | Occasional trips | Frequent journeys |
| Demo coverage | Selected journey | Ongoing travel |
| Demo setup | Choose travel dates | Add your vehicle |
| Next step | Review a pass | Explore an account |

### A simple way to choose

1. Think about how often you travel.
2. Check that your road and vehicle are covered.
3. Review the official terms before making a choice.

[Explore accounts and passes](/account-and-passes)`,
  notice: `## Let's take it one step at a time.

${notice}

🟡 Sample notice awaiting review (demo)

| Notice summary | Fictional value |
| --- | --- |
| Reference | DEMO-000123 |
| Vehicle | DEMO-CAR |
| Status | Not a real notice |

### Your next steps

1. **Check the details.** Match the vehicle and journey to your notice.
2. **Review your options.** Use the official notice issuer's information.
3. **Keep a confirmation.** Save the receipt if you make a payment.

> Never enter payment information, passwords or a real notice reference into this mock preview.

[Review payment information](/pay-for-tolls)`,
  image: `## A picture can make it clearer.

${notice}

### Image available

![Illustrative route from Riverside to Garden Park.](/__mock/route.svg)

### Image unavailable

![Route image unavailable. Continue with the written journey details below.](/__mock/missing-route.png)

The missing image above deliberately returns **404** so you can inspect the accessible fallback.

[View written road information](/using-toll-roads)`,
  slow: `## Thanks for waiting.

${notice}

This mock waited **4.5 seconds** before streaming. The existing loading indicator, disabled send state and streamed Markdown are all using the real chat renderer.

🟢 Mock response complete

[Explore travel options](/account-and-passes)`,
  error: `## You're back on track.

${notice}

The first request deliberately returned **503**. Your retry succeeded against the local mock API.

🟢 Retry completed (demo)

No live service was contacted.`,
};

exports.routeImage = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="220" viewBox="0 0 760 220">
<rect width="760" height="220" rx="20" fill="#edf6ef"/>
<path d="M0 62H760M0 170H760M175 0V220M550 0V220" stroke="#d7e8dc" stroke-width="22"/>
<path d="M20 0L95 220M650 0L715 220" stroke="#dcebf0" stroke-width="32"/>
<path d="M85 155H240Q280 155 280 118V100Q280 65 320 65H665" fill="none" stroke="#0a6e30" stroke-width="10" stroke-linecap="round"/>
<path d="M85 155H240Q280 155 280 118V100Q280 65 320 65H665" fill="none" stroke="#9cdaa9" stroke-width="2" stroke-dasharray="4 9"/>
<circle cx="85" cy="155" r="13" fill="white" stroke="#0a6e30" stroke-width="5"/>
<circle cx="665" cy="65" r="13" fill="#0a6e30" stroke="white" stroke-width="5"/>
<g font-family="sans-serif" font-size="17" font-weight="bold" fill="#214c31"><text x="42" y="197">Riverside</text><text x="602" y="109">Garden Park</text></g>
<rect x="24" y="20" width="230" height="28" rx="14" fill="white"/><text x="39" y="39" font-family="sans-serif" font-size="12" fill="#58616c">ILLUSTRATIVE ROUTE / DEMO ONLY</text>
</svg>`;

const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Journey checked</title><path d="m5 12 4 4 10-10" fill="none" stroke="#0a6e30" stroke-width="3"/></svg>';
exports.fixtures.media = [
  { kind: 'text', text: `## Images, SVG and icons\n\n${notice}\n\n### Markdown image\n\n![Journey map](/__mock/route.svg)\n\n### A2A image URL\n\n` },
  { kind: 'file', file: { name: 'Journey image attachment', mimeType: 'image/svg+xml', uri: '/__mock/route.svg' } },
  { kind: 'text', text: '\n\n### Base64 SVG icon\n\n' },
  { kind: 'file', file: { name: 'Journey checked icon', mimeType: 'image/svg+xml', bytes: Buffer.from(icon).toString('base64') } },
  { kind: 'text', text: `\n\n### Raw SVG in text\n\n${icon}\n\n### Base64 raster image (one pixel)\n\n` },
  { kind: 'file', file: { name: 'One-pixel PNG', mimeType: 'image/png', bytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } },
  { kind: 'text', text: '\n\n### Invalid attachments show explanations\n\n' },
  // eslint-disable-next-line no-script-url -- Intentional invalid-source fixture.
  { kind: 'file', file: { name: 'Blocked URL', mimeType: 'image/png', uri: 'javascript:alert(1)' } },
  { kind: 'file', file: { name: 'Invalid SVG', mimeType: 'image/svg+xml', bytes: Buffer.from('<svg>broken').toString('base64') } },
  { kind: 'file', file: { name: 'Non-image file', mimeType: 'application/pdf', uri: '/__mock/document.pdf' } },
  { kind: 'data', data: { icon: 'car' } },
  { kind: 'text', text: '\n\nThe unknown data part is intentionally ignored. Arbitrary icon names or card schemas are not interpreted.\n\n[Written journey information](/using-toll-roads)' },
];

exports.routePlan = {
  ok: true,
  origin: { label: 'Flinders Street (demo)', position: [144.96512, -37.8182] },
  destination: { label: 'Melbourne Airport (demo)', position: [144.85017, -37.67137] },
  distance_km: 24.7,
  duration_minutes: 23,
  tolled_distance_km: 9.3,
  untolled_distance_km: 15.4,
  currency: 'AUD',
  toll_total: 6.82,
  tolls: [{
    name: 'MELBOURNE CITYLINK',
    system: 'MELBOURNE CITYLINK',
    currency: 'AUD',
    amount: 6.82,
    estimate: false,
    payment_methods: ['Transponder'],
  }],
  toll_roads: [{ name: 'Tullamarine Fwy', number: 'M2' }],
  toll_payment_sites: [
    { name: 'Travancore (demo)', position: [144.93942, -37.78523] },
    { name: 'Brunswick West (demo)', position: [144.93786, -37.75851] },
  ],
  segments: [
    { tolled: false, points: [[144.96512, -37.8182], [144.9601, -37.8175], [144.951, -37.814]] },
    {
      tolled: true,
      points: [[144.9333, -37.80943], [144.9301, -37.80947], [144.914, -37.788], [144.9, -37.75]],
    },
    { tolled: false, points: [[144.875, -37.704], [144.862, -37.686], [144.85017, -37.67137]] },
  ],
  assumptions: [
    'LOCAL DEMO: illustrative geometry and fictional estimates, not routing advice.',
    'Priced for a car with a Linkt tag',
    'Published toll rates, not a live quote',
    'Untagged trips may attract additional fees',
  ],
};

const toolPart = (kind, value) => ({
  kind: 'data', data: { toolData: { kind, toolUseId: `demo-${kind}`, value } },
});
const followUps = toolPart('followUps', {
  options: ["What if I don't have a tag?", 'Check tolls on another route', 'What roads are tolled?'],
});
const completed = { kind: 'status-update', status: { state: 'completed' }, final: true };
const routeEvents = (value) => [
  { kind: 'task', status: { state: 'working' }, history: [{ role: 'user', parts: [{ kind: 'text', text: 'User history must not appear as an assistant reply.' }] }] },
  { kind: 'status-update', status: { state: 'working', message: { role: 'agent', parts: [{ kind: 'text', text: 'Preparing your sample route...' }, { kind: 'data', data: { toolEvent: { phase: 'start' } } }] } } },
  { kind: 'status-update', status: { state: 'working', message: { role: 'agent', parts: [toolPart('routePlan', value), followUps] } } },
  {
    kind: 'artifact-update', append: false, lastChunk: true, artifact: { artifactId: 'answer', parts: [{ kind: 'text', text: `## Your sample journey\n\n${notice}\n\nThe returned route and its assumptions appear below. This is an illustrative fixture, not live navigation.` }] },
  },
  { kind: 'status-update', status: { state: 'working', message: { role: 'agent', parts: [toolPart('routePlan', value), followUps, { kind: 'data', data: { toolEvent: { phase: 'end' } } }] } } },
  completed,
].map((result) => ({ result }));

exports.statementCard = {
  found: true,
  statement_id: 'DEMO-STATEMENT-2026-09',
  statement_date: '2026-09-25',
  period: { from: '2026-08-25', to: '2026-09-24' },
  opening_balance: { amount_aud: 10, position: 'owing' },
  payments_received_aud: 10,
  trip_charges_aud: 5,
  fees_and_adjustments_aud: 0.24,
  fees_and_adjustments_label: 'Demo card surcharge',
  video_matching_fees_aud: 0,
  total_charged_aud: 5.24,
  gst_included_aud: 0.48,
  closing_balance: { amount_aud: 5.24, position: 'owing' },
  trip_count: 1,
  status: 'Due',
  due_on: '2026-10-09',
  paid_on: null,
  lines: [
    {
      charged: '2026-09-02', type: 'trip', details: 'Fictional demo toll trip', amount_aud: 5, trip_id: 'DEMO-TRIP-1', start: '7:41am', finish: '7:45am', by: 'Demo tag A',
    },
    {
      charged: '2026-09-08', type: 'payment', details: 'Fictional demo payment', amount_aud: -10,
    },
    {
      charged: '2026-09-08', type: 'adjustment', details: 'Demo card surcharge', amount_aud: 0.24,
    },
  ],
  trip_charges_by_tag: { 'Demo tag A': 5, 'Demo spare tag': 0 },
  notes: ['LOCAL DEMO: fictional statement data, not a customer account or payment request.'],
};

const positioningMedia = ['D', 'C'].map((tag) => ({
  type: 'image',
  src: `/help/tags/${tag}-type-tag-position-car.svg`,
  alt: `${tag === 'D' ? 'Mini' : 'Small'} tag positioned behind the rear-view mirror`,
  caption: tag === 'D' ? 'Mini tag: horizontal, behind the mirror' : 'Small tag: vertical, behind the mirror',
}));

function aguiHelpEvents(id, value, answer, options, toolCallName = 'tag_health_check') {
  const messageId = `${id}-answer`;
  return [
    { type: 'TOOL_CALL_START', toolCallId: id, toolCallName },
    { type: 'CUSTOM', name: 'helpMedia', value: { toolCallId: id, ...value } },
    { type: 'TOOL_CALL_END', toolCallId: id },
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    ...(answer.match(/[\s\S]{1,65}/g) || []).map((delta) => ({
      type: 'TEXT_MESSAGE_CONTENT', messageId, delta,
    })),
    ...(options.length ? [{
      type: 'CUSTOM', name: 'followUps', value: { toolCallId: `${id}-followups`, options },
    }] : []),
    { type: 'TEXT_MESSAGE_END', messageId },
    { type: 'RUN_FINISHED' },
  ];
}

exports.eventFixtures = {
  'agui-help-question': aguiHelpEvents('demo-question', {
    status: 'question',
    step: 'beeping',
    question: 'Is your tag beeping when you go through a toll point?',
    options: ['Yes', 'No'],
    media: [],
    account_check: {
      tag_number_ending: '9999',
      status: 'Active',
      last_known_plate: 'DEMO-01',
      last_detected: '1 October 2026',
      trips_matched_by_plate_since: 7,
      summary: 'Your fictional tag ending 9999 is Active, but the last 7 demo trips were matched by plate.',
    },
  }, 'Your fictional tag ending 9999 is active, but your last 7 demo trips were matched by number plate.\n\nIs your tag beeping when you go through a toll point?', []),
  'agui-help-holder': aguiHelpEvents(
    'demo-holder',
    {
      status: 'outcome',
      outcome: 'no_holder',
      advice: 'Without a holder the tag usually sits in the wrong spot to be read. It needs to be clipped into a windscreen holder, high and central behind the rear-view mirror.',
      offer: {
        action: 'order_replacement_tag',
        item: 'holder',
        prompt: 'Would you like me to send you a tag holder?',
      },
      media: positioningMedia,
    },
    'Without a holder, your tag sits in the wrong spot to be read. It needs to be clipped into a windscreen holder, positioned high and central behind the rear-view mirror.\n\nWould you like me to send you a tag holder?',
    ['Yes, order it', 'No thanks'],
  ),
  'agui-help-video': aguiHelpEvents(
    'demo-beeps',
    {
      status: 'outcome',
      outcome: 'working',
      advice: "A beep at a toll point means the tag was read there. 1 beep means you're good to go. 3 or 4 beeps is a warning about the account (low balance or suspended, depending on the tag style), and no beep means the tag wasn't read. Check the tag travels in its holder on every trip.",
      offer: null,
      media: [{ type: 'video', youtubeId: 'OvsDIBF1emE', title: 'What do the tag beeps mean?' }],
    },
    "Your tag is working when it beeps at a toll point: one beep means it was read, three or four beeps warn about your account, and no beep means it wasn't read.\n\nMake sure it travels in its holder on every journey.",
    ['How do I install my tag?', 'Why was I charged video matching fees?', 'Explain a specific trip'],
  ),
  'agui-help-install': aguiHelpEvents(
    'demo-install',
    {
      found: true,
      topic: 'install',
      title: 'Installing your tag',
      steps: [
        'Slide the tag into its holder until it clicks. Leave the backing on the adhesive for now.',
        'Try the position before sticking: high and central behind the rear-view mirror, with at least 7cm clear of other objects. Mini tags sit horizontally, small tags vertically.',
        'Clean the spot with a cloth and let it dry, peel off the backing, and press the holder firmly against the glass for 30 seconds.',
        "Drive as normal. The tag beeps at each toll point, and your account detects it automatically - there's nothing to set up online.",
      ],
      media: [
        ...['insert', 'position', 'angle'].flatMap((stage) => ['D', 'C'].map((tag) => ({
          type: 'image',
          src: `/help/tags/${tag}-type-tag-${stage}-car.svg`,
          alt: `${tag === 'D' ? 'Mini' : 'Small'} tag: ${stage}`,
          caption: `${tag === 'D' ? 'Mini' : 'Small'} tag: ${stage}`,
        }))),
        { type: 'video', youtubeId: '7sT7hg396EQ', title: 'How to install a tag in your vehicle' },
      ],
    },
    "Here's how to install your tag:\n\n1. Slide the tag into its holder until it clicks (keep the backing on the adhesive).\n2. Try the position first: high and central behind the rear-view mirror, at least 7cm clear of other objects.\n3. Clean the spot, let it dry, peel the backing off and press the holder firmly for 30 seconds.\n4. Drive as normal - the tag beeps at tolls and your account detects it automatically.\n\nThe illustrations and video below show the position and angle for both mini and small tags.",
    ['Check my tag', "Tag isn't beeping", 'Metallic windscreen'],
    'tag_how_to',
  ),
  'agui-statement': [
    { type: 'TOOL_CALL_START', toolCallId: 'demo-statement', toolCallName: 'get_statement_details' },
    { type: 'CUSTOM', name: 'statementCard', value: { ...exports.statementCard, toolCallId: 'demo-statement' } },
    { type: 'TOOL_CALL_END', toolCallId: 'demo-statement' },
    { type: 'TEXT_MESSAGE_START', messageId: 'demo-statement-answer', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'demo-statement-answer', delta: 'This is a fictional statement for local visual testing. All supplied statement details appear below.' },
    { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'demo-statement-followups', options: ['Why were trips matched by plate?', 'Check my recent trips', 'Explain a specific trip'] } },
    { type: 'TEXT_MESSAGE_END', messageId: 'demo-statement-answer' },
    { type: 'RUN_FINISHED', threadId: 'demo-statement-thread', runId: 'demo-statement-run' },
  ],
  'agui-route': [
    { type: 'TEXT_MESSAGE_START', messageId: 'demo-preface', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'demo-preface', delta: "I'll price that drive for you." },
    { type: 'TEXT_MESSAGE_END', messageId: 'demo-preface' },
    { type: 'TOOL_CALL_START', toolCallId: 'demo-route', toolCallName: 'plan_toll_route' },
    { type: 'CUSTOM', name: 'routePlan', value: { ...exports.routePlan, toolCallId: 'demo-route' } },
    { type: 'TOOL_CALL_END', toolCallId: 'demo-route' },
    { type: 'TEXT_MESSAGE_START', messageId: 'demo-answer', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'demo-answer', delta: `## Your sample journey\n\n${notice}\n\nThe map below is an illustrative fixture, not a live quote.` },
    { type: 'CUSTOM', name: 'followUps', value: { toolCallId: 'demo-followups', options: ['Check a different route', 'Plan another trip'] } },
    { type: 'TEXT_MESSAGE_END', messageId: 'demo-answer' },
    { type: 'RUN_FINISHED', threadId: 'demo-aws-thread', runId: 'demo-aws-run' },
  ],
  route: routeEvents(exports.routePlan),
  'route-invalid': routeEvents({
    ...exports.routePlan,
    segments: [{ tolled: true, points: [[null, -37.8], [144.9, -37.7]] }],
  }),
  interrupted: [
    { result: { kind: 'artifact-update', artifact: { artifactId: 'partial', parts: [{ kind: 'text', text: 'This partial answer should remain visible when the stream closes without completion.' }] } } },
  ],
  'rpc-error': [
    { result: { kind: 'status-update', status: { state: 'working', message: { parts: [{ kind: 'text', text: 'This partial answer precedes a deliberate JSON-RPC error.' }] } } } },
    { error: { code: -32603, message: 'Intentional local error after partial content' } },
  ],
};

exports.helpMedia = {
  found: true,
  topic: 'install',
  title: 'Installing your tag',
  steps: [
    'Slide the tag into its holder until it clicks. Leave the backing on the adhesive for now.',
    'Try the position before sticking: high and central behind the rear-view mirror, with at least 7cm clear of other objects. Mini tags sit horizontally, small tags vertically.',
    'Clean the spot with a cloth and let it dry, peel off the backing, and press the holder firmly against the glass for 30 seconds.',
    "Drive as normal. The tag beeps at each toll point, and your account detects it automatically - there's nothing to set up online.",
  ],
  media: [
    {
      type: 'image', src: '/help/tags/D-type-tag-insert-car.svg', alt: 'A mini tag sliding into its holder', caption: 'Mini tag',
    },
    {
      type: 'image', src: '/help/tags/C-type-tag-insert-car.svg', alt: 'A small tag sliding into its holder', caption: 'Small tag',
    },
    { type: 'video', youtubeId: '7sT7hg396EQ', title: 'How to install a tag in your vehicle' },
  ],
};
const helpEvents = (value) => [
  { kind: 'status-update', status: { state: 'working', message: { parts: [{ kind: 'text', text: 'Preparing help instructions...' }] } } },
  { kind: 'status-update', status: { state: 'working', message: { parts: [toolPart('helpMedia', value), followUps] } } },
  { kind: 'artifact-update', lastChunk: true, artifact: { artifactId: 'help-answer', parts: [{ kind: 'text', text: `## Installation help\n\n${notice}\n\nThese are sample instructions from the supplied response contract. Illustration hosting is not yet confirmed; video availability is unverified.` }] } },
  { kind: 'status-update', status: { state: 'working', message: { parts: [toolPart('helpMedia', value)] } } },
  completed,
].map((result) => ({ result }));
exports.eventFixtures.help = helpEvents(exports.helpMedia);
exports.eventFixtures['help-not-found'] = helpEvents({ ...exports.helpMedia, found: false });
exports.eventFixtures['help-invalid'] = helpEvents({
  found: true,
  title: 'Help with invalid references (local fixture)',
  steps: ['A valid written instruction remains visible.', null, 42],
  media: [
    null,
    { type: 'image', src: '//unapproved.invalid/image.svg', caption: 'Blocked reference' },
    { type: 'video', youtubeId: '../invalid', title: 'Invalid video' },
    { type: 'unknown', src: '/do-not-render-as-html' },
  ],
});
exports.fixtures['help-text-only'] = 'The answer mentions installation pictures and a video, but includes no structured helpMedia result. No help card or video should be fabricated.';

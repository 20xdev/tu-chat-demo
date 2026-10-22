# Your Project's Title...
Your project's description...

## Styling

The site uses a Linkt-aligned green and white palette and the bundled Open Sans font.
Shared colour, typography, and content-width tokens live in `styles/styles.css`;
block styles remain scoped to their blocks. The chat uses a compact bottom-centre
launcher, a desktop dialog centred horizontally and vertically in the viewport,
and a full-screen mobile dialog. At viewport widths of 1200px and above, the
dialog expands up to 1600px wide and 1200px tall, with viewport gutters, a wider
conversation area and 18px message/composer text. Smaller desktop/tablet layouts
and the mobile keyboard-aware sizing are unchanged.
The dialog separates its white header from the soft conversation background,
with white assistant cards, green user bubbles, and a rounded composer. Keyboard
focus remains visible, and reduced-motion preferences disable UI transitions.
Selected style-lab treatments are included in the application stylesheet: subtle
green surfaces, response headings, callouts, and table colours. Images retain
automatic sizing, wide tables remain scrollable, and ordinary links stay inline.

For visual checks, review `/`, `/pay-for-tolls`, `/account-and-passes`, and
`/using-toll-roads` at desktop and mobile widths. Check the mobile navigation and
chat open, close, suggestion, message, and retry states. Page content and imagery
are authored separately in AEM; CSS changes do not replace the demo content.
With a conversation in progress, resize from desktop to mobile and back; verify
that messages reflow and the close button and composer remain within the visible
viewport, including when the mobile keyboard changes the available space.

### Chat configuration and authentication

The chat loads its public configuration from the fixed root-relative path
`/config.json` on the current frontend origin, using
`scripts/chat-config.js`. There was no AIO browser-config loader or Cognito
implementation in this branch; its old direct A2A proxy flow has been migrated
to the supplied AG-UI frontdoor contract. There is no AIO fallback.

Sheet rows map generically into the ten public fields: `authorizationEndpoint`,
`tokenEndpoint`, `logoutEndpoint`, `clientId`, `redirectUri`, `scope`,
`agentEndpoint`, `responseType`, `codeChallengeMethod`, and `protocol`.
Required values, duplicate/unsafe keys, row types, complete pagination, HTTPS
URLs, callback origin, `code`, `S256`, `ag-ui`, and `openid` are validated before
login or chat can proceed. Unknown settings do not enter application state.
Exact callback and encoded AWS endpoint strings are retained. The credential-free
sheet request is shared across initialization paths; failed loads can be retried.

`scripts/chat-auth.js` implements public-client Authorization Code + PKCE with
Web Crypto, independent random state/verifier, a ten-minute session-scoped pending
transaction, root callback handling, one-time consumption and callback cleanup.
Only the owned `tu-chat.pkce.v1` transaction is stored in session storage.
Access/refresh tokens remain in memory, are never stored in cookies or browser
storage, and are not logged. Reloading requires signing in again. Expiring access
tokens use a deduplicated standard refresh grant when available; failed refresh
requires sign-in. `CHAT_ACCESS_TOKEN` is no longer read or required, and
`X-Chat-Access-Token` is never sent. No client secret or replacement shared secret
is used.

The header's **Log in** button and the bottom launcher's **Log in to chat**
prompt use the same Cognito sign-in flow. After a successful callback, the header
shows **Log out** and the launcher opens chat. The chat dialog contains no login
or logout buttons; its authentication status area is hidden while signed in.
Logging out or losing the session clears the conversation, aborts active requests
and restores the launcher login prompt. The signed-out launcher keeps the
**Log in to chat** label even when setup fails; errors remain visible separately
and can be retried from the header or, after closing the dialog, the launcher.

The published callback currently belongs to the `main` preview origin. Other
branches, localhost and the live origin deliberately show an actionable
configuration error if their origin differs. They cannot silently substitute a
callback. To enable another real frontend, its callback must be registered with
the provider and represented in approved configuration. The local mock lab below
does not use real Cognito authentication.

No registered sign-out destination exists in project configuration. **Sign out
is local only**: it clears owned authentication/conversation state and warns that
Cognito single-sign-on may remain active. The configured Hosted UI logout
endpoint is retained, but no unregistered logout destination is guessed.

`scripts/chat-agui.js` sends only the newest user message directly to the
sheet's `agentEndpoint`, with bearer **access-token** authentication, omitted
browser credentials, and a stable runtime-session UUID header. Threads and
sessions persist until reset; run/message UUIDs are fresh per send. The AG-UI
body contains `threadId`, `runId`, `state`, `messages`, `tools`, `context` and
`forwardedProps`, never an A2A JSON-RPC envelope. A real HTTP 401 permits one
refresh/retry before reading output, preserving run/message IDs. Error text
containing "401" never triggers refresh; partial streams are not replayed.

The adapter supports text deltas, tool progress, run errors, optional lifecycle
events and clean text-only stream closure. Incremental SSE framing is shared
with the retained A2A adapter. Malformed/failed streams produce visible errors
while preserving earlier text. Markdown tables, images and sanitised SVG in text
continue through the existing response renderer.
Gaps after tool completion retain the loading indicator until an answer arrives.
Failures clear obsolete progress; rejected non-SSE response bodies are cancelled,
and a missing response stream has an explicit error.

**Observed AG-UI route and follow-up content is supported.** `CUSTOM` events named
`routePlan` and `followUps` feed the existing map and suggestion renderers, upserting
by event name and `value.toolCallId`. Repeated identical results retain their views;
tool completion and later text do not remove them. Supported events do not show
the unsupported-content notice. Unknown CUSTOM names are held only in bounded
per-turn memory (20 events and 64 KiB), never logged or dumped into HTML, and
produce one unsupported-content notice per assistant turn. Truncation is disclosed.
Reset/disposal drops retained events and interactive views. Observed `helpMedia`
events also reuse the existing help renderer for instructions, illustrations
and external video links.

External prerequisites remain Cognito public-client code/PKCE registration,
the exact callback origin, supported refresh grants, a registered Hosted UI
sign-out destination if required, and Cognito/AWS browser CORS. The AWS frontdoor
must accept Authorization, Content-Type, Accept and
`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` and return SSE. Mock tests do not
verify customer login, provider CORS, or an authenticated AG-UI media contract.

Root-relative loading avoids the former cross-origin request from branch or
localhost pages to the `main` sheet and works on nested page paths. Each frontend
must serve its configuration at `/config.json`; no query-string URL override or
cross-origin fallback is accepted. This does not rewrite `redirectUri`: a branch
sheet that still points to the `main` callback will fail callback-origin
validation. Local style testing should use the isolated fixture lab rather than
weakening the production authentication checks.

### Chat response images

The renderer accepts text/Markdown and retains support for standard A2A `file`
parts in the independently tested legacy adapter. The current AG-UI flow supplies
text deltas, not A2A attachments. Text can contain Markdown image syntax,
HTML `<img>` tags, or raw SVG artwork. SVG inside a fenced code block stays code.
Image URLs may be relative or HTTP(S); data URLs are accepted for the supported
image types below. Ordinary hyperlinks are not automatically embedded.

Image file parts use **one** of these shapes:

```json
{"kind":"file","file":{"name":"Journey map","mimeType":"image/svg+xml","uri":"https://example.com/map.svg"}}
{"kind":"file","file":{"name":"Journey icon","mimeType":"image/svg+xml","bytes":"BASE64_ENCODED_SVG"}}
```

`bytes` is base64, not a data URL, and requires an image MIME type. URI files may
omit `mimeType`; the browser still needs to be able to load the resource as an
image. PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG are accepted, subject to browser
support. Base64/data-URL images have a **5 MiB decoded limit per image**. Remote
images are loaded directly by the browser; they must be reachable without custom
authorization headers and permitted by the site's Content Security Policy.

Embedded SVG is sanitised and displayed through an `<img>`, never inserted as
active SVG in the page. Common shapes, text, gradients and local definitions are
supported; scripts, event handlers, animation, stylesheets, foreign HTML, and
external SVG references are not. SVG/PNG icons use the same image path and retain
natural sizing. Arbitrary icon names, icon-font HTML, non-image files, and
uncontracted `data`-part schemas are not interpreted. Invalid image attachments
and image load failures show an explanatory text fallback. Data URLs must be
allowed by the deployed `img-src` policy to display inline images.

### Retained A2A route and follow-up components

This section describes the retained A2A contracts and the components also reused
for observed AG-UI route and follow-up payloads. `scripts/chat-stream.js`
adapts A2A task snapshots, status messages, artifacts, and direct messages into
per-turn state. It retains structured tool results when final answer artifacts
replace provisional text. Artifact `lastChunk` is tracked separately from task
completion. A stream closing without a completion/action-required state retains
partial content and shows the existing interruption/retry UI; `[DONE]` alone is
not A2A completion. A direct A2A message is a complete message response.

The production `scripts/chat-agui.js` adapter handles the observed raw AWS events
separately from the legacy A2A adapter. These custom events feed the same renderers:

```json
{"type":"CUSTOM","name":"routePlan","value":{"toolCallId":"route-1","ok":true}}
{"type":"CUSTOM","name":"statementCard","value":{"toolCallId":"statement-1","found":true,"statement_id":"DEMO-STATEMENT","statement_date":"2026-09-25"}}
{"type":"CUSTOM","name":"tripList","value":{"toolCallId":"trips-1","trips":[]}}
{"type":"CUSTOM","name":"helpMedia","value":{"toolCallId":"help-1","found":true,"topic":"install","title":"Installing your tag","steps":["Returned instruction"],"media":[{"type":"image","src":"/help/tags/D-type-tag-insert-car.svg","alt":"Mini tag"},{"type":"video","youtubeId":"7sT7hg396EQ","title":"Tag installation video"}]}}
{"type":"CUSTOM","name":"followUps","value":{"toolCallId":"followups-1","options":["Check a different route","Plan another trip"]}}
```

The route example is abbreviated and requires the full geometry described below.
Cards upsert by event name and `value.toolCallId`; identical repeated results keep
their existing views. Tool completion and later text do not remove the map or
suggestions. The unsupported-content notice appears only for unrecognized custom
names, not `routePlan`, `statementCard`, `tripList`, `helpMedia` or `followUps`.
AG-UI `helpMedia` preserves the supplied title, ordered instructions, illustration
order, alt text, captions and video title/link using the existing asset allowlist
and explicit invalid-data/load-error fallbacks. `topic` identifies the help subject;
it does not change the trusted asset base. The local lab's **AWS AG-UI route
+ follow-ups** scenario exercises the raw event format using fictional demo data.
The **AWS AG-UI statement + follow-ups** scenario uses fictional statement data;
no customer attachment is committed to the fixtures.

`statementCard` renders the statement ID/date/period, status and due/paid dates,
opening and closing balances with their supplied positions, payments received,
trip charges/count, fees and their label, reported video matching fees, included
GST and total charged. It preserves the backend totals without adding fee fields
again or inventing a reconciliation. All amounts use AUD as specified by the
`*_aud` fields, including negative payments and zero balances.
Transaction rows retain charged dates, types, descriptions, amounts, trip IDs,
start/finish times and tag/plate attribution. Tag charge breakdowns retain zero
entries; all supplied notes are shown as plain text. Invalid dates or numeric
strings are not coerced; usable fields remain visible with an explicit warning.
`found: false` produces an unavailable-statement message, not an empty success card.
The expanded statement layout uses a prominent closing balance (or the supplied
total if no closing balance is available), status badge and date summary.
Balance/payment and charge groups precede a full-width transaction table with
compact, wrapping metadata. Tag amounts use individual tiles; notes sit in a
separate reading panel. All sections stay expanded, including on mobile, and no
financial values are recalculated for the design. At phone widths, transaction
rows become full-width stacked entries with date/amount above the description
and metadata; explicit table roles preserve accessible row/header relationships.

AG-UI `tripList` cards show every supplied trip in its original order, without
truncation. Each entry retains its ID, date/start/finish, road/from/to, detection
method, plate/vehicle, charged timestamp, statement, toll, video matching fee
and supplied total. Human-readable dates remain unchanged; `*_aud` amounts use
AUD without coercing numeric strings or recomputing totals. Known detection
labels receive Tag/Plate badges; the full original description remains visible.
All details stay expanded. Empty lists show an explicit no-trips message;
malformed data shows an explanatory warning while retaining usable entries.

Recognised data parts use:

```json
{"kind":"data","data":{"toolData":{"kind":"routePlan","toolUseId":"route-1","value":{"ok":true}}}}
{"kind":"data","data":{"toolData":{"kind":"followUps","toolUseId":"followups-1","value":{"options":["What roads are tolled?"]}}}}
{"kind":"data","data":{"toolData":{"kind":"helpMedia","toolUseId":"help-1","value":{"found":true,"title":"Installing your tag","steps":["Returned instruction"],"media":[]}}}}
```

The abbreviated `routePlan.value` above must also contain labelled `origin` and
`destination` positions and nonempty `segments` with a boolean `tolled` and at
least two valid points each. Positions must be finite numeric
`[longitude, latitude]` pairs in geographic ranges. Invalid geometry rejects the
map rather than joining across bad points. All valid segment points are
preserved; segments are not connected or simplified. Available distance,
duration, toll estimates, and assumptions accompany the map. Missing currency
is not assumed to be AUD.

`scripts/chat-tools.js` uses the approved **demo** provider: Leaflet 1.9.4
(JS/CSS lazily loaded from jsDelivr) and
`https://tile.openstreetmap.org/{z}/{x}/{y}.png`. No API key or backend credentials
are required. Attribution remains visible, tile requests send an origin referrer,
and normal browser caching is retained. See the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
There is no service SLA: production use needs a provider/privacy/capacity review.
Browser requests reveal the client's IP and viewed map area to the tile service.
A restrictive deployment CSP must permit the pinned CDN scripts/styles and OSM
tile images; the local mock's API restriction is not relaxed.

Route cards follow the local styling references: map first, top-right zoom
controls, a bold origin/destination title, compact distance/duration, itemized
backend tolls and a total, road-distance legend, and a muted assumptions footer.
The map refits the complete route when its dimensions change, including when
switching between desktop and mobile layouts.
Optional `tolls` rows require a name and finite nonnegative numeric amount;
their currency uses an explicit row currency or the route's declared currency.
Supplied toll `system`, boolean `estimate` (including `false`), and
`payment_methods` appear below each toll name. Optional `toll_roads` supply
names and route numbers for the legend. Optional `toll_payment_sites` appear
as named, hollow map markers and a written list with latitude/longitude;
their positions are included when fitting map bounds. Invalid
optional details show an explanatory warning without discarding valid geometry.
Missing prices, currencies and road names are not fabricated.

AG-UI text deltas from every assistant message are rendered, and `followUps`
options become buttons. Coordinates are used to draw every supplied segment and
place origin, destination and payment-site markers. Event/message/tool/thread/run
identifiers and lifecycle flags correlate the stream; they are not customer-facing
content. Backend `ok: false` produces a visible unavailable-route message.

Tolled roads use solid green lines; untolled roads use dashed gray lines, retaining
a non-color distinction and accessible legend descriptions. The map provider and
attribution remain unchanged. Chat uses pale-mint user bubbles, white outlined
assistant cards and compact green-outlined follow-up pills, as in the references.
Written summaries and assumptions remain available if the provider cannot load.
Follow-up buttons use the normal send flow and conversation UUID, and are
disabled during requests. Results upsert by tool-call identity within their turn.
Unknown data kinds and internal tool progress are ignored, never rendered as HTML.
Reset/retry disposes obsolete maps and cancels obsolete requests. Chat history
remains in-memory only; this feature does not add persistence or simultaneous sends.

### Illustrated help and video references

In the retained A2A adapter, `helpMedia` is collected from status, artifact, task
and message parts. Production AG-UI `CUSTOM helpMedia` events reuse this renderer.
Cards are retained alongside the final text answer and upserted per tool-call ID
within their assistant turn. Instruction results require boolean `found: true` to enable media.
Valid instructions remain readable for unsuccessful or malformed results.
Titles, ordered steps, alt text, and captions are plain text. Illustrations are
not assigned to steps: media ordering is preserved as supplied.

The observed `status: "question"` variant instead renders its `question` and
validated `options` as accessible answer buttons through the normal chat send
flow, retaining conversation/session context and busy/reset/disposal behavior.
It does not require `found`, `steps` or images; `media: []` is a valid text-only
question and produces no unavailable-media or missing-instructions warning.
Optional `account_check` shows its summary, tag ending, account status, last
known plate, last detection and supplied plate-matched trip count (including
zero). Strings remain plain text, dates are not reinterpreted, and numeric
strings are not coerced to counts. Malformed question/options/account data
still produces explicit warnings while usable content remains visible.
`step` is backend workflow metadata, not a replacement question or instruction.

Six installation illustrations are stored in [`help/tags/`](help/tags/), matching
the root-relative `/help/tags/` paths supplied by the agent. With the project
owner's confirmation of reuse authorisation, they were downloaded on 2026-10-21
from the [official Linkt installation guide's](https://www.linkt.com.au/help/travelling-toll-roads/installing-tags-in-cars-or-light-commercial-vehicles)
asset directory, `https://www.linkt.com.au/content/dam/linkt/help/illustrations/`.
Original SVG files and names are preserved: the `C-type` and `D-type` variants
of `tag-insert-car.svg`, `tag-position-car.svg`, and `tag-angle-car.svg`.

**The chat uses the bundled `/help/tags/` directory on its own code origin by
default.** No metadata is needed for these six illustrations. Deploy the SVG files
alongside the chat scripts; copying assets locally does not publish them to an
existing AEM preview/live site. The legacy fixture uses two image references;
browser regression checks also replay the observed AG-UI `helpMedia` shape with
all six real SVG files and a video reference through the production chat flow.

To override the bundled location with a confirmed trusted HTTPS asset host and
directory, supply page metadata `chat-help-asset-base`. For example,
**only after replacing this
example with the approved location**:

```html
<meta name="chat-help-asset-base" content="https://assets.example.invalid/help/tags/">
```

An origin-only configuration uses the observed `/help/tags/` directory. A full
directory URL must end with `/`; relative filenames resolve inside it, while
root-relative paths retain their path on that approved origin. Both relative
and absolute image URLs must remain within the configured origin and directory.
Protocol-relative URLs, embedded credentials, query/fragment parameters,
path escapes, ambiguous encoded separators and invalid URL syntax are rejected.
HTTP is allowed only for loopback development (`localhost`, `127.0.0.1`, or
`[::1]`) on the exact origin serving the chat helper module, including its port.
Other HTTP origins remain blocked, and production asset locations require HTTPS.
The backend payload cannot configure its own asset base. Invalid explicit
configuration and failed image loads produce visible fallbacks, not a silent
switch to another host.

Images use normal lazy `<img>` elements, anonymous CORS, no-referrer, reserved
layout space, and one-shot load-error fallbacks. The configured asset host must
allow anonymous cross-origin image requests if external; otherwise instructions
remain available with a load-failure notice. No chat headers or credential query
parameters are added to media requests. SVG references are never fetched and
injected as markup. This stricter policy applies to structured help assets;
existing Markdown/A2A image attachments retain their previous renderer.

Video handling is deliberately **external links only**, as approved. Valid
11-character YouTube IDs create `https://www.youtube.com/watch?v=...` links
labelled with the title and new-tab behaviour, with `noopener noreferrer`.
No iframe, player, autoplay, thumbnail, or YouTube request is created by chat,
regardless of the demo consent state. Video availability is explicitly
unverified. The existing default-declined consent stub is unchanged.

### Rollback

The pre-structured-response baseline is Git commit
`db372e5156b8829f3d552bc21b95830b224d1b09`. A separate verified archive of the
existing chat, image renderer, style lab, and related manifests/documentation was
saved outside the served repository before implementation.

To use that archive, stop the style lab, preserve any newer work first, and
extract it from the repository root with
`tar -xzf /absolute/path/to/chat-before-structured-responses-20261021-1130.tar.gz`.
This restores the archived files; it does not remove newly added files.
The new `scripts/chat-stream.js`, `scripts/chat-tools.js` and
`scripts/chat-help.js` may then be removed
if no later work uses them. Restart the style lab and refresh the browser.
Do not use a blanket repository reset that discards unrelated work.

A second verified snapshot, `chat-before-help-media-20261021-1153.tar.gz`, preserves
the route-enabled implementation immediately before help-media support.
Restoring that archive keeps the maps/follow-ups; only `scripts/chat-help.js`
is new relative to that snapshot and may be removed if unused.

## Environments
- Preview: https://main--tu-chat-demo--20xdev.aem.page/
- Live: https://main--tu-chat-demo--20xdev.aem.live/

## Documentation

Before using the aem-boilerplate, we recommand you to go through the documentation on https://www.aem.live/docs/ and more specifically:
1. [Developer Tutorial](https://www.aem.live/developer/tutorial)
2. [The Anatomy of a Project](https://www.aem.live/developer/anatomy-of-a-project)
3. [Web Performance](https://www.aem.live/developer/keeping-it-100)
4. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

## Installation

```sh
npm i
```

## Linting

```sh
npm run lint
```

## Local development

1. Create a new repository based on the `aem-boilerplate` template
1. Add the [AEM Code Sync GitHub App](https://github.com/apps/aem-code-sync) to the repository
1. Install the [AEM CLI](https://github.com/adobe/helix-cli): `npm install -g @adobe/aem-cli`
1. Start AEM Proxy: `aem up` (opens your browser at `http://localhost:3000`)
1. Open the `tu-chat-demo` directory in your favorite IDE and start coding :)

### Local chat style lab

The style lab is a development-only mock server, not an EDS block or production
service. It requires Node.js 18 or newer and has no additional dependencies.

1. Keep the AEM development proxy running on `http://localhost:3000`:

   ```sh
   npx -y @adobe/aem-cli up --no-open
   ```

2. In a second terminal, from the repository root, run:

   ```sh
   npm run dev:chat
   ```

3. Open **http://localhost:3100/__mock/preview.html**, not port 3000. Select a
   scenario and click **Run mock**. Toggle **Experimental styles** to compare
   against the application styles, or **Mobile width** for a narrow preview.
   This toggle controls only the remaining experimental overrides, not the
   selected cosmetic styles already included in the application stylesheet.

The preview explicitly starts a **synthetic local session**, not a real Cognito
login. It covers Markdown journey images, comparisons/checklists, image failures,
slow streams, HTTP failure/retry, AG-UI errors, a synthetic arbitrary CUSTOM
event and a route/follow-up fixture using the observed AWS event shape.
All demo values are fictional; do not enter personal or payment information.

The original A2A fixture endpoint and rich-content fixtures remain available for
independent adapter/component regression checks, not as a production fallback.
Those checks cover map geometry, help illustrations, captions, media validation
and follow-up callbacks. AG-UI integration checks cover the supplied AWS route
and help-media contracts, including all six local illustrations, mobile layout,
deduplication, follow-up context and reset cleanup. The referenced video is not
fetched or verified.

After restarting the style lab, open
**http://localhost:3100/__mock/renderer-tests.html** for repeatable renderer checks.
They check sheet loading/validation, real PKCE helper logic with mocked token
responses, callback/refresh/logout paths, AG-UI requests and SSE, bounded CUSTOM
retention, the real block with synthetic authentication, responsive sizing and
the retained A2A renderer/component contracts. They do not call the live chat API.
There is no build step or build script; use the existing lint commands and these
native-browser tests.
To run a separate lab instance without stopping an existing
one, use `CHAT_STYLE_LAB_PORT=3101 npm run dev:chat` and open the corresponding port.

The lab binds to loopback only. It reads pages from the local AEM proxy, replaces
the chat endpoint and auth singleton only in served JavaScript responses, and
blocks external API
connections using a preview-only Content Security Policy. It never rewrites the
application files or forwards write requests to the upstream site. Port 3000
continues to use the real chat integration.

Preview files are in `tools/chat-style-lab/`, excluded from EDS delivery by
`.hlxignore`, and are not imported by application code. Edit `fixtures.cjs` or
`experimental.css` there to experiment; refresh the browser after CSS changes and
restart `npm run dev:chat` after fixture or server changes. Stop it with Ctrl+C.
If port 3100 is occupied, stop the existing style-lab process before restarting.

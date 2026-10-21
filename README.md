# Your Project's Title...
Your project's description...

## Styling

The site uses a Linkt-aligned green and white palette and the bundled Open Sans font.
Shared colour, typography, and content-width tokens live in `styles/styles.css`;
block styles remain scoped to their blocks. The chat uses a compact bottom-centre
launcher, a desktop dialog centred horizontally and vertically in the viewport,
and a full-screen mobile dialog.
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

### Chat response images

The renderer accepts text/Markdown and standard A2A `file` parts in streamed
artifacts, messages, and status messages. Text can contain Markdown image syntax,
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

### Structured routes and follow-ups

The existing A2A 0.3 `message/stream` URL and cookie-based
`X-Chat-Access-Token` authentication are unchanged. `scripts/chat-stream.js`
adapts task snapshots, status messages, artifacts, and direct messages into
per-turn state. It retains structured tool results when final answer artifacts
replace provisional text. Artifact `lastChunk` is tracked separately from task
completion. A stream closing without a completion/action-required state retains
partial content and shows the existing interruption/retry UI; `[DONE]` alone is
not A2A completion. A direct A2A message is a complete message response.
Adobe may buffer the response; the loading indicator does not promise live tokens.

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

Tolled roads use solid green lines; untolled roads use dashed slate lines.
Written summaries and assumptions remain available if the provider cannot load.
Follow-up buttons use the normal send flow and conversation UUID, and are
disabled during requests. Results upsert by tool-call identity within their turn.
Unknown data kinds and internal tool progress are ignored, never rendered as HTML.
Reset/retry disposes obsolete maps and cancels obsolete requests. Chat history
remains in-memory only; this feature does not add persistence or simultaneous sends.

### Illustrated help and video references

`helpMedia` is collected from the same status, artifact, task and message parts.
Cards are retained alongside the final text answer and upserted per tool-call ID
within their assistant turn. Only the boolean `found: true` enables media.
Valid instructions remain readable for unsuccessful or malformed results.
Titles, ordered steps, alt text, and captions are plain text. Illustrations are
not assigned to steps: media ordering is preserved as supplied.

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
existing AEM preview/live site. The fixture uses the two image references from
the supplied abbreviated contract, rather than fabricating the full six-image
response. Browser regression checks additionally load all six real SVG files.

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

The fixtures cover a route image and journey summary, pass comparisons, a notice
checklist, missing-image fallback, slow streaming, and a failed request that
succeeds on retry. **Image files, base64, SVG + icons** also exercises mixed
text/file parts and intentional invalid attachments. All values are fictional.
Do not enter real personal or payment information.
The structured-route scenarios exercise status-message route data, replacement
answer artifacts, repeated tool results, follow-ups, invalid geometry, premature
stream closure and JSON-RPC errors. Normal fixtures end with an A2A completed
status, not a custom `[DONE]` marker. Route coordinates are illustrative, not
real routing advice. These scenarios load the approved external map tiles.
Help scenarios cover instructions/video references with unconfigured images,
`found: false`, invalid entries, and text-only mentions that must not fabricate
media. The referenced video is not fetched or verified by the lab.

After restarting the style lab, open
**http://localhost:3100/__mock/renderer-tests.html** for repeatable renderer checks.
They check the application renderer, request/SSE adapter, route validation,
follow-ups, help-card state, trusted media URLs, and external-only video behaviour
using fixtures, not the live chat API.
To run a separate lab instance without stopping an existing
one, use `CHAT_STYLE_LAB_PORT=3101 npm run dev:chat` and open the corresponding port.

The lab binds to loopback only. It reads pages from the local AEM proxy, replaces
the chat endpoint in the served JavaScript response, and blocks external API
connections using a preview-only Content Security Policy. It never rewrites the
application files or forwards write requests to the upstream site. Port 3000
continues to use the real chat integration.

Preview files are in `tools/chat-style-lab/`, excluded from EDS delivery by
`.hlxignore`, and are not imported by application code. Edit `fixtures.cjs` or
`experimental.css` there to experiment; refresh the browser after CSS changes and
restart `npm run dev:chat` after fixture or server changes. Stop it with Ctrl+C.
If port 3100 is occupied, stop the existing style-lab process before restarting.

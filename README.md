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
uncontracted `data`-part schemas are not interpreted. Invalid/unsupported content
and image load failures show an explanatory text fallback. Data URLs must be
allowed by the deployed `img-src` policy to display inline images.

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

After restarting the style lab, open
**http://localhost:3100/__mock/renderer-tests.html** for repeatable renderer checks.
They use the application renderer and the same Markdown/sanitiser libraries, not
the live chat API. To run a separate lab instance without stopping an existing
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

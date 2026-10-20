# Your Project's Title...
Your project's description...

## Styling

The site uses a Linkt-aligned green and white palette and the bundled Open Sans font.
Shared colour, typography, and content-width tokens live in `styles/styles.css`;
block styles remain scoped to their blocks. The chat uses a compact bottom-centre
launcher, a desktop dialog centred horizontally and vertically in the viewport,
and a full-screen mobile dialog.

For visual checks, review `/`, `/pay-for-tolls`, `/account-and-passes`, and
`/using-toll-roads` at desktop and mobile widths. Check the mobile navigation and
chat open, close, suggestion, message, and retry states. Page content and imagery
are authored separately in AEM; CSS changes do not replace the demo content.

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

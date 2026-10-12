# OpenLogs brand

| File | Use |
|---|---|
| `openlogs-mark.svg` | The log mark (a log end with a chart-line crack), source of the app icons in `src-tauri/icons/`; `npm run icons` regenerates them. |
| `openlogs-wordmark-on-dark.svg`, `openlogs-wordmark-on-light.svg` | The "openlogs" wordmark for dark and light backgrounds, with the beaver and the log mark as its two "o"; the letters are Fraunces 700 converted to outlines, so no font is needed. |
| `openlogs-beaver-on-dark.svg`, `openlogs-beaver-on-light.svg` | The beaver "o" on its own. |

Colours: wood `#e8913a`; bark `#4a2511` (`#8b5a35` on dark); growth ring, pith and crack `#4a2511`; letters `#f4eadb` on dark and `#4a2511` on light. The beaver's teeth are in the letter colour.

`npm run icons` rewrites `icon.icns` with different bytes on every run even when nothing changed (the Tauri CLI orders its entries at random); discard such an icns-only change.

The app draws the wordmark itself (`ui/src/components/AppLogo.tsx`, geometry in `logoGeometry.ts`) so it follows the theme; `AppLogo.test.tsx` keeps its shapes identical to these files (the colours come from the theme tokens).

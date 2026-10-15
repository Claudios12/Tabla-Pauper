# Project: Pauper Deck Arena

Pauper MTG deck tracker and tournament performance analyzer. Single-file PWA (index.html) with vanilla JS/CSS. Mobile-first, Spanish UI.

## Design standard: tasteskill v2 house rules

Apply these rules to all CSS and UI work. They override any default AI tendencies.

### Hard bans — never write these

| Banned | Use instead |
| --- | --- |
| `linear-gradient` or `radial-gradient` as backgrounds, on buttons, or in text | Flat color |
| `backdrop-filter: blur(...)` — glass panels | Solid opaque background |
| `box-shadow` on elements at rest (cards, buttons, icons) | Tone step between surfaces (`background` color difference) |
| `text-shadow` glows | Color alone for emphasis |
| `background: linear-gradient` on nav active states | Flat `rgba` tint |
| Ambient gradient blobs (`body::before/::after` with radial gradients) | Nothing — the background color is the background |
| Gradient on `<button>` or `.btn` | Single flat fill color; darker shade on `:active` |
| `:focus` box-shadow glow ring wider than 2px | 2px offset ring in the accent color, no spread |

### Shadows — when they ARE allowed

Shadows are only for elements that truly float above the page:
- Dropdown menus, popovers, modals, dialogs

Everything else uses a background tone step to separate surfaces.

### Color system

One ground, one ink, one accent. The current system:
- Ground: `#0a0e14` (`--bg-main`)
- Surfaces: `#111822` → `#16202e` → `#1c293c` (three tone steps, no lines needed between them)
- Ink: `#f0f6fc` (`--text-primary`)
- Accent: `#f97316` (`--color-brand`) — appears on primary action and one other thing max
- Status colors: green `#10b981`, cyan `#06b6d4`, red `#f43f5e` — semantic use only

Do not introduce violet, indigo, yellow-cream, or terracotta accents.

### Typography

Two faces max: Outfit (display/headings) and Inter (body). Already loaded.
- Running text: 16px min, `--text-primary` color, never soft grey for primary content
- Labels and secondary info: `--text-secondary` or `--text-muted`, sentence case preferred
- Avoid tiny all-caps tracked labels in marketing contexts; acceptable for table headers and form labels in this app context

### Buttons

Flat fill, one color. Square corners (`var(--radius-sm)` = 8px) already set.
- Primary: `background: var(--color-brand)`, dark text
- Active state: darker flat shade, no shadow
- No gradients, no glows

### Motion

Keep existing transitions (opacity, transform only). No scroll event listeners for animation — use `IntersectionObserver` or CSS `@keyframes`. Respect `prefers-reduced-motion`.

### What's exempt (per tasteskill spec)

- Real `<table>` borders and form field borders are fine
- Focus rings on interactive elements are required for accessibility
- `<pre>`/`<code>` blocks may use monospace

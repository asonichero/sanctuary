# Sanctuary: Wellness & Composure

Low-poly management simulation built with Vite, Three.js and Tailwind CSS.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Layout

| Path | Purpose |
| --- | --- |
| `src/core/EventBus.js` | Pub/sub bus and the `Events` name registry; systems talk only through it |
| `src/world/EstateBuilder.js` | Renderer, studio lighting, camera rig and the estate blockout (zones) |
| `src/main.js` | Boot and the frame loop (emits `engine:tick`) |
| `src/style.css` | Tailwind entry and HUD styles |

## Camera

LMB drag orbit · RMB drag pan · wheel zoom (to cursor) · WASD move focus · Q/E rotate · F reset.

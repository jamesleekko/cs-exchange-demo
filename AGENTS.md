# Repository Guidelines

## Project Structure & Module Organization

This client-only Vite + Vue 3 prototype implements a CS2-style trade-up contract. `src/App.vue` owns rules, state, and the `<script setup>` workflow; `src/main.js` mounts it, and `src/style.css` provides global styling. Active Three.js effects live in `src/three/contract.js` and `src/three/furnace.js`; `case.js` and `forge.js` are not connected to the UI. Runtime assets are under `public/bg/`, `public/models/`, and `public/sfx/`. `scripts/` contains asset generators, Blender export tooling, and Playwright smoke helpers. There is no backend or dedicated test directory.

## Build, Test, and Development Commands

Use npm with Node 20.19+ or 22.12+ (required by Vite 7).

- `npm run dev` starts Vite on port 5173 and opens the app.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the production bundle.
- `node scripts/gen-anvil-sound.mjs` regenerates the forge, furnace, contract, and pen WAV assets in `public/sfx/`.
- `npm run dev -- --port 5175`, followed in another terminal by `node scripts/test-furnace.mjs`, exercises the full interactive flow with Playwright screenshots.

## Coding Style & Naming Conventions

Use two-space indentation, single-quoted JavaScript, and Vue 3 Composition API with `<script setup>`. No formatter or linter is configured, so match surrounding semicolon usage. Use camelCase for variables/functions, PascalCase for Vue components, and `createFeature` for Three.js factories. Group feature logic in `App.vue`.

When changing tiers, update `RARITIES`, `RARITY_ORDER`, `SKIN_POOL`, and `BASE_PRICE` together. Three.js modules need explicit lifecycle methods; `dispose()` must release RAFs, listeners, observers, scene resources, and renderer state. Regenerate assets instead of hand-editing WAV or GLB output.

## Testing Guidelines

There is no `npm test`, coverage requirement, or lint command. Before submission, run `npm run build` and manually test selection, confirmation, stamping, furnace close/open, reveal, reset, and responsive layout. For animation changes, verify resize, stop, and disposal without stale RAF loops, duplicate callbacks, console errors, or leaked WebGL contexts. `scripts/test-*.mjs` are standalone smoke helpers, not a managed suite.

## Commit & Pull Request Guidelines

History uses concise conventional prefixes, primarily `feat:`; use `fix:`, `refactor:`, or `docs:` when appropriate. Keep commits focused. Pull requests should summarize behavior and validation, link issues, and include screenshots or recordings for visual changes. Identify generated assets and record their rebuild command.

## Agent-Specific Terminology

For collection-platform discussions, MPS means `shared-merchant-mps` plus the `payment-b2b-merchant-platform` micro-app connected through `micro-app`. OPS refers to `recv-ops-platform`.

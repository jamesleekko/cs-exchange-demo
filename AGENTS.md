# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite + Vue 3 prototype for a CS2-style trade-up contract experience. The main application logic and UI live in `src/App.vue`; `src/main.js` only mounts the app. Global styles are in `src/style.css`, while component-scoped styles are kept inside Vue single-file components.

Three.js animation modules live in `src/three/`, including forge, contract, and starfield effects. Static audio assets are stored in `public/sfx/`. The script `scripts/gen-anvil-sound.mjs` regenerates procedural sound effects and should be preferred over hand-editing generated WAV files.

## Build, Test, and Development Commands

- `npm run dev` starts the Vite development server for local iteration.
- `npm run build` creates the production build in `dist/`.
- `npm run preview` serves the built output for a production-like smoke test.
- `node scripts/gen-anvil-sound.mjs` regenerates forge/anvil audio assets in `public/sfx/`.

There is currently no configured test runner or lint command.

## Coding Style & Naming Conventions

Use Vue 3 Composition API with `<script setup>` for component logic. Keep state, computed values, and view-flow methods grouped by feature so the large `App.vue` remains navigable. Use descriptive camelCase names for variables and functions, and PascalCase for component names if new components are introduced.

UI copy and comments may follow the existing Chinese-language convention. Preserve the current game-rule invariants when editing tier data: update rarity definitions, rarity ordering, skin pools, and base prices together.

## Testing Guidelines

Because no automated tests are configured, validate changes manually with `npm run dev` and run `npm run build` before submitting. For animation or Three.js changes, verify that forge sequences start, resize, stop, and dispose cleanly without stale animation loops or WebGL context leaks.

If tests are added later, prefer focused Vitest unit coverage for pure trade-up rule helpers and Playwright coverage for the core user flow.

## Commit & Pull Request Guidelines

Recent commits use concise conventional prefixes, especially `feat:`. Continue that style, for example `feat: add contract sound cue` or `fix: prevent duplicate forge reveal`.

Pull requests should include a short behavior summary, manual validation steps, linked issues when applicable, and screenshots or screen recordings for visible UI or animation changes. Note any changes to generated assets and include the command used to regenerate them.

## Agent-Specific Instructions

For discussions about the collection projects, `shared-merchant-mps` is the MPS main app, `payment-b2b-merchant-platform` is the MPS micro-app sub-application, and `recv-ops-platform` is the OPS platform. When discussing MPS, treat it as the main app plus sub-application system connected by `micro-app`.

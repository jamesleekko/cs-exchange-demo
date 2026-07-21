# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An interactive prototype of a CS2-style "汰换合同" (trade-up contract): the user drags same-quality skins into a contract, confirms, and watches an animated forge sequence produce a higher-tier skin with a randomized profit/loss outcome. UI and code comments are in Chinese. This is a demo/prototype — there is no backend, no persistence, and no test suite.

## Commands

```bash
npm run dev        # Vite dev server on :5173 (auto-opens; allows *.trycloudflare.com hosts)
npm run build      # production build to dist/
npm run preview    # serve the built dist/

node scripts/gen-anvil-sound.mjs         # regenerate forge/anvil WAVs in public/sfx/
node scripts/gen-case-sound.mjs          # regenerate weapon-case WAVs (case-land/case-open) in public/sfx/
node scripts/gen-console-sfx.mjs         # regenerate material-add/remove/complete WAVs in public/sfx/
node scripts/gen-pen-check-variants.mjs  # generate pen-check sound variants into public/temp/ for audition
python3 scripts/build-console-frame.py  # crop + cut screen glass from the cassette console source image (requires Pillow)
```

There is no linter or test runner configured. Validate changes manually with `npm run dev` and run `npm run build` before submitting. Commits use conventional prefixes (`feat:`, `fix:`).

## Architecture

The entire application lives in **`src/App.vue`** (~3500 lines, Vue 3 `<script setup>`, naive-ui components under a `darkTheme` + `themeOverrides` config provider). `src/main.js` just mounts it. When changing behavior, expect to edit App.vue.

App.vue is organized as:
- **Game data** (top of `<script setup>`): `RARITIES` (7 CS2 quality tiers with color + `need` count), `RARITY_ORDER`, `SKIN_POOL` (skins per tier), `BASE_PRICE`. These are the source of truth for the trade-up rules.
- **Core rules**: `generateOutcome(items, count)` produces the trade-up result strictly following CS2 logic — output tier is one above input, output skin is random from the next tier's pool, and profit/loss is a weighted random factor over input cost. `wearTier(float)` maps a float to the CS2 exterior grade (崭新出厂…战痕累累).
- **Selection state & validation**: `selected`, `activeRarity`, `currentNeed`, `canAdd`/`addItem`/`lockReason` enforce the rules — all inputs must share one quality; `need>0` tiers only (non-tradeable `gold` has `need=0`); `consumer`–`classified` need 10, `covert` needs 5.
- **View flow**: mutually exclusive phases toggled by refs — `showBuilder` → (`showContract` → furnace close/open) → `showResult`. `startCraft()` computes the outcome then sets `showBuilder = false`; the builder's leave-transition completing fires `onBuilderLeaveComplete` → `startContract()`. There is no longer a user-selectable animation mode; the unified flow is always contract → furnace.
- **Material console** (`materialConsolePhase`): a side-panel console widget that tracks the intake phase in order — `selecting` → `feeding` → `ready` → `imminent` → `processing` → `complete`. Phases only advance forward (enforced by rank map); use `setMaterialConsolePhase(phase, force)` to set them. The console displays a physical frame image (`console-screen-foundry-cassette-cutout.png`). A `consoleEnabled` ref gates whether the developer console overlay is permitted to open.
- **Developer console**: a draggable overlay panel (refs `developerConsoleVisible`, `developerConsoleDragging`, `developerConsoleOffset`) that surfaces at the `onPreClimax` callback of the furnace reveal sequence.

Trade-up rule invariant: if you change tier counts, tradeability, or add tiers, update **both** `RARITIES` and `RARITY_ORDER` (and `SKIN_POOL`/`BASE_PRICE` for any new tradeable tier) together.

### three.js modules (`src/three/`)

- **`furnace.js`** — persistent background 3D furnace (GLTF model, rendered 24 fps). `createFurnace(canvas)` returns `{ showOpen, close, armReveal, open, dispose }`. The furnace is created once in `onMounted` and stays alive for the full session. `showOpen()` snaps to the open idle pose. `close(callbacks)` runs the lid-lower animation and fires `onCloseStart`, `onClose`, `onClosed`. `armReveal(opts)` queues the reveal sequence (called immediately after `onClosed`) and fires `onOpen`, `onColumn`, `onRumbleStart`, `onRumbleEnd`, `onPreClimax`, `onClimax`, `onDone`. `open()` triggers the reveal (called by the contract's `onDone` callback, or queued if close is still running). Supports four surface variants: `aged`, `blued`, `olive`, `ceramic`.
- **`contract.js`** — the "合同签订" confirm animation, same handle shape (`{ play, stop, resize, dispose }`) and callback pattern (`onPhase`, `onPaper`, `onAwaitStamp`, `onStamp`, `onDone`). The contract page is drawn frame-by-frame on an offscreen 2D canvas (Chinese text, per-item rarity colors, animated check-mark stroke and stamp) and mapped as a texture onto a 3D plane. After `onAwaitStamp` fires, the stamp must be triggered by calling `contract.triggerStamp()` (wired to the `showStampHint` click). `getStampScreenPosition()` returns `{ x, y, diameter }` in canvas-relative pixels for positioning the hint overlay.
- **`transparent-bloom.js`** — custom postprocessing pass (UnrealBloom variant that preserves alpha channel transparency). Used by `furnace.js`.
- **`forge.js`**, **`case.js`**, **`starfield.js`** — exist in the repo but are not currently imported by App.vue. Do not delete them; they may be revived.

The furnace and contract are coordinated in `startContract()`: `lowerFurnace()` runs in parallel with `contract.play()`, so the furnace begins closing at the same moment the contract slides in. When the contract's `onDone` fires, it calls `furnace.open()` which either starts the reveal immediately (if already closed) or queues it.

### Styles

- **`src/style.css`** — global (minified, single line) styles for the stage, builder, classic process animation, result view, keyframes (`boom`, `edgePulse`, `sheen`, `shake`), and responsive rules.
- App.vue `<style scoped>` overrides the layout, styles the material/contract cards, the furnace overlay, the material console panel, and the developer console overlay.

### Assets

Everything in `public/sfx/` and `public/temp/` is procedurally generated 16-bit PCM (synthesized from oscillators/noise, no third-party libs) — regenerate via the `scripts/*.mjs` generators rather than editing WAVs by hand. `public/temp/` holds audition variants; the chosen one is copied into `public/sfx/` for actual use.

`public/console-frames/console-screen-foundry-cassette-cutout.png` is built from `console-screen-foundry-cassette.png` by `scripts/build-console-frame.py` (crops to the display area and punches out the screen glass polygon with SSAA). Run the script after editing the source image; it requires `Pillow` (`pip install pillow`).

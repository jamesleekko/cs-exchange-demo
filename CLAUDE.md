# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An interactive prototype of a CS2-style "汰换合同" (trade-up contract): the user drags same-quality skins into a contract, confirms, and watches an animated forge sequence produce a higher-tier skin with a randomized profit/loss outcome. UI and code comments are in Chinese. This is a demo/prototype — there is no backend, no persistence, and no test suite.

## Commands

```bash
npm run dev        # Vite dev server on :5173 (auto-opens; allows *.trycloudflare.com hosts)
npm run build      # production build to dist/
npm run preview    # serve the built dist/

node scripts/gen-anvil-sound.mjs   # regenerate public/sfx/*.wav (procedural audio, no deps)
```

There is no linter or test runner configured.

## Architecture

The entire application lives in **`src/App.vue`** (~1300 lines). `src/main.js` just mounts it. When changing behavior, expect to edit App.vue.

App.vue is organized as:
- **Game data** (top of `<script setup>`): `RARITIES` (7 CS2 quality tiers with color + `need` count), `RARITY_ORDER`, `SKIN_POOL` (skins per tier), `BASE_PRICE`. These are the source of truth for the trade-up rules.
- **Core rules**: `generateOutcome(items, count)` produces the trade-up result strictly following CS2 logic — output tier is one above input, output skin is random from the next tier's pool, and profit/loss is a weighted random factor over input cost. `wearTier(float)` maps a float to the CS2 exterior grade (崭新出厂…战痕累累).
- **Selection state & validation**: `selected`, `activeRarity`, `currentNeed`, `canAdd`/`addItem`/`lockReason` enforce the rules — all inputs must share one quality; `need>0` tiers only (non-tradeable `gold` has `need=0`); `consumer`–`classified` need 10, `covert` needs 5.
- **View flow**: three mutually exclusive phases toggled by refs — `showBuilder` → (`showProcess` or `showForge`) → `showResult`. `startCraft()` computes the outcome first, then dispatches to `startClassic()` or `startForge()` based on `animMode`.
- **Two animation modes** (`animMode`, default `'forge'`): `'classic'` is pure DOM/CSS card-collapse + particle explosion driven by `setTimeout` in App.vue; `'forge'` delegates to the three.js module below.

Trade-up rule invariant: if you change tier counts, tradeability, or add tiers, update **both** `RARITIES` and `RARITY_ORDER` (and `SKIN_POOL`/`BASE_PRICE` for any new tradeable tier) together.

### three.js modules (`src/three/`)

- **`forge.js`** — the "熔炉锻造" confirm animation. `createForge(canvas)` returns `{ play, stop, resize, dispose }`. `play(opts)` runs one full timed sequence (投料 → 升火 → 落锤 → 产物) and drives the outside world through callbacks: `onIgnite`, `onPhase(text)`, `onStrike`, `onReveal`, `onDone`. App.vue uses these callbacks to play sounds, flash the stage edge, and switch to the result view. Uses `three/addons` postprocessing (UnrealBloom) and custom particle shaders.
- **`starfield.js`** — ambient background particles. `createStarField(canvas)` returns `{ dispose }`.

Both are imperative handles created in `onMounted` and cleaned up in `onBeforeUnmount`/`resetAll`. Always call `dispose()` when tearing down to avoid leaking WebGL contexts and RAF loops.

### Styles

- **`src/style.css`** — global (minified, single line) styles for the stage, builder, classic process animation, result view, keyframes (`boom`, `edgePulse`, `sheen`, `shake`), and responsive rules.
- App.vue `<style scoped>` overrides the layout, styles the material/contract cards, the forge overlay, and the animation-mode switch.

### Assets

`public/sfx/anvil-strike.wav` and `forge-ignite.wav` are generated procedurally by `scripts/gen-anvil-sound.mjs` (16-bit PCM synthesized from oscillators/noise, no third-party libs). Regenerate with that script rather than editing the WAVs.

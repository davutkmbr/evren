# Phase 26 — Online (seventeenskies.com and servers)

Milestone: F · Multiplayer · Effort: stage 0 S, stage 1 L · Networking design: [15 — Multiplayer](15-multiplayer.md)

## Goal

The game is playable at seventeenskies.com, alone or on a named server (Sanalika-style server list), at the lowest
running cost.

## Platform: Cloudflare

- **Static build on Workers static assets.** Requests to static assets are free and unmetered, which removes the main
  cost of a ~600 MB web game (bandwidth). Limits: 25 MiB per file, 20 000 files (free) / 100 000 (paid).
- **One Durable Object per server** (stage 1). WebSocket hibernation: idle servers cost nothing. Location hint `eeur`
  or `me`; an object does not move after creation, so the hint is chosen per server.
- Cost estimate for one full server (50 players, 10 position updates/s, 24/7): ~65 M billable requests/month (incoming
  WebSocket messages count 20:1) ≈ $10, duration inside the included 400 000 GB-s. Base: Workers Paid, $5/month.

Sources: developers.cloudflare.com — durable-objects/platform/pricing, durable-objects/reference/data-location,
workers/static-assets/billing-and-limitations, workers/platform/limits.

## Stage 0 — static deploy (done in this branch)

- `wrangler.jsonc`: assets-only Worker `seventeen-skies`, custom domains seventeenskies.com and www.
- `npm run build:web`: public build with the private assets (`EVREN_PRIVATE_DIR` points a worktree at the main
  checkout's `private-assets/`), then
  `scripts/deploy/stage.mjs` copies the shipping street layer (world/index.json, the areas it lists, `_shared`, `walls`;
  experiment folders never ship), removes `sandbox/` and checks the Workers limits.
- `worker/index.ts` runs only for `/audio/music/private/*` (`run_worker_first`): the US-risky historic recordings get
  451 for the US and its territories, unknown country and Tor, and `Cache-Control: private` elsewhere. The game then
  keeps its mood music. Every other file is served as a static asset without the Worker.
- `public/_headers`: hashed `/assets/*` cached immutable; everything else revalidates (world files keep stable names).
- No overrides in production: the public build compiles `DEV_TOOLS` (`src/core/dev-tools.ts`) to false. Every URL
  override reads through `devParams()` / `parseDebugFlags()` and gets no parameters; every `window.__*` debug hook goes
  through `exposeDebug()` and is stripped. Only a read-only `window.__evren` (`ready`, `pending()`, `stats()`) stays,
  for screenshot and performance tooling. Dev server, sandboxes and plain `npm run build` keep all tools. Client checks
  only stop casual tampering; online cheats are stopped by the server (stage 1 validation).
- `npm run deploy`: build:web + `wrangler deploy`. Needs `npx wrangler login` once and the seventeenskies.com zone in
  the same Cloudflare account. From a worktree: `EVREN_WORLD_DIR=<main>/public/world EVREN_PRIVATE_DIR=<main>/private-assets npm run deploy`.

Measured: 4 919 files, 587 MiB; served by `wrangler dev`, the game and the Galata street tiles load with no errors
beyond the two absent private manifests.

## Stage 1 — servers (next)

- Worker endpoint `/api/servers`: name, player count, region.
- `ServerRoom` Durable Object: WebSocket with hibernation, max 50 players, nickname only (no accounts).
- Relay, not authoritative physics: clients send pose snapshots (5–10 Hz), the room broadcasts one batched snapshot per
  tick; simple speed/teleport checks.
- Client: remote dragons drawn ~100 ms behind with interpolation; start screen offers "Tek başına" / "Sunucu seç".
- First step: a probe Durable Object to measure real round-trip times from Turkish ISPs before fixing the region.

### Probe results

Live at seventeenskies.com/probe since 2026-09-27; the probe objects were created from Istanbul and do not move.

| Region hint | Object colo | TurkNet, Istanbul (ingress IST): median / p90 |
|---|---|---|
| `eeur` | FRA | 49 / 49 ms |
| `weur` | AMS | 57 / 59 ms |
| `me` | PRG | 69 / 70 ms |
| none (auto) | PRG | 69 / 70 ms |

`me` does not land in the Middle East from Istanbul. Region choice waits for Türk Telekom, Turkcell, Superonline
and Vodafone results.

### Remote dragons (done in branch claude/remote-dragons)

The client side of other players, before any server (the part of phase 14 that online needs):

- `src/net/snapshot.ts`: the 67-byte binary snapshot (position f32, orientation and velocity i16, mode, flags, 32 pose
  fields as bytes, ground plane); `src/net/capture.ts` takes it from the local dragon. Codec round trip: position
  exact, orientation 1e-5, worst pose field 0.012 rad.
- `src/dragon/remote/`: the `remoteDragons` service. `RemoteDragonKit` builds the geometry (procedural rider, fixed
  reins) and 1024 px textures once, on the first remote dragon; each `RemoteDragon` has its own skeleton, animator and
  material objects, which share one compiled program (no new programs with 15 dragons). `SnapshotBuffer` draws 100 ms
  behind the newest snapshot: Hermite position from the velocities, slerped orientation, phases the short way round,
  up to 250 ms of coasting when the stream stalls. LOD bands by distance: animation every 1 / 2 / 4 / 8 frames up to
  350 / 1200 / 4000 / 9000 m, shadows only in the first band, hidden beyond.
- `?bots=N` (local builds only): N dragons replay the local dragon's own snapshots 1.5 s + 0.4 s per bot later, in
  formation, through the codec and the buffer.
- The local rig's geometry assembly moved to `src/dragon/model/geometry/assemble.ts` (shared with the kit).

Measured with 15 bots in the nearest band (headless, shared GPU): remote-dragons CPU ~1.0 ms per frame (0.07 ms per
dragon), +2.5–5.7 M triangles and +47–125 draw calls including shadows. Frame rates on the shared GPU were too noisy
to judge (the same baseline ran at 46 and 20 fps); the 16-dragon 60 fps target of phase 14 needs a measurement on an
idle machine. If the GPU cost is too high, the next step is a lighter mesh for the 350 m+ bands.

## Stage 2 — later

Turnstile against bots, chat with moderation, persistent profiles (D1).

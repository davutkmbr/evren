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

### Remote dragons (done)

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

### Game servers (done, branch feat/game-servers)

- `src/net/protocol.ts`: the shared protocol (no imports; the Worker type-checks it too). Text `hello` / `welcome` /
  `join` / `leave` / `error`, binary snapshots up, one binary batch per 100 ms down (`u8 type, u16 count, count ×
  (u16 id, snapshot)`). Nicknames: 2–16 letters, digits, space, `_ . -`.
- `worker/rooms.ts`: `ServerRoom` Durable Object per named server (Boğaziçi, Haliç, Adalar), created with the `eeur`
  hint, WebSocket hibernation (seats rebuilt from socket attachments). Relay with checks, not a simulation: 50 seats,
  a token bucket (20 messages/s, 40 burst), world bounds, a speed limit between snapshots (160 m/s + 30 m); a
  teleport-flagged jump passes once per 5 s. 200 rejected messages close the socket (4001). The room keeps the
  latest snapshot per player and broadcasts every 100 ms while something changed, so a receiver gets ~8–10 per
  second per player. `GET /api/servers` lists the servers with their player counts.
- `src/net/client.ts` + `src/net/system.ts`: the `net` service (`listServers`, `join(server, name)`, `leave`, players,
  status, last error). While online the local snapshot goes out at 10 Hz on average whatever the frame rate
  (accumulated pacing), teleports are flagged (the `teleport` event or a jump over 300 m) and receivers restart their
  buffer instead of flying across the map; relayed snapshots go to `remoteDragons`. Dropped connections retry after
  1, 3 and 8 s; a refusal does not. `?server=<id>&name=<nick>` joins on start (local builds only).

Tested against `wrangler dev`: welcome / join / leave, relay, speed jump dropped, teleport accepted once, second
teleport inside the cooldown dropped, out-of-world dropped, bad name and old version refused (4000), 51st player
refused (`full`), a 300-message flood closed with 4001, server list counts. End to end: the game joined a server and
drew a second player (a Node client mirroring it through the room) 35 m beside it.

Open: a hidden tab stops `requestAnimationFrame`, so its dragon freezes for the others until it returns (an "away"
state or leaving after a timeout); the start screen's server list and nickname input (the UI step); name tags and
players on the minimap.

### Accounts (done, branch feat/accounts)

Decision (2026-09-27): no forced login. "Online oyna" makes a guest account with a nickname; "Google ile kaydet"
links it to Google later and keeps the profile. Achievements, quests and other progress tables are planned separately
before they reach the database.

- D1 database `seventeen-skies` (created in eeur), schema in `migrations/` (`0001_accounts.sql`: Better Auth's tables
  from `scripts/db/auth-schema.mts` plus `profile`). Local: `npx wrangler d1 migrations apply seventeen-skies --local`.
- `worker/auth.ts`: Better Auth 1.7 on D1 (native binding), anonymous plugin (guest e-mails on
  `guest.seventeenskies.com`, never mailed), Google when `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set, 90-day
  sessions, telemetry off. Session rows keep no IP address or user agent (a database hook; `disableIpTracking` alone
  still stored them). Linking a guest to Google moves the guest's profile unless the Google account has one.
- `worker/account.ts`: `GET /api/me` (user or null, profile, whether Google is offered), `PUT /api/me/profile`
  (nickname rules from the protocol, unique regardless of case with Turkish folding: Işıl = ışıl), `DELETE /api/me`
  (user, sessions, Google link and profile by cascade; KVKK). Writes need the site's own Origin.
- Rooms: the WebSocket upgrade needs the site's Origin (no cross-site socket riding the cookie), a session (401) and a
  profile (403); the Worker passes the account and nickname to the room in headers it sets itself, so a client cannot
  name itself. Protocol v2: the hello carries only the version. One seat per account: joining again replaces the old
  seat (`replaced`).
- Client: `src/net/account.ts` provides the `account` service with plain fetch calls (no auth library in the game
  bundle): status, user, nickname, `playAsGuest`, `setNickname`, `signInWithGoogle` (redirect), `signOut`,
  `deleteAccount`. `net.join(server)` uses the profile.

Tested against `wrangler dev --local-upstream 127.0.0.1:8799` (without it wrangler rewrites Host and Origin to the
production route): every rule above, including the cascade delete and empty IP / user agent columns; the game signed
in as a guest, took the nickname and joined a server.

Before production: `npx wrangler d1 migrations apply seventeen-skies --remote`, `npx wrangler secret put
BETTER_AUTH_SECRET`, and for Google a Google Cloud OAuth client (redirect URI
`https://seventeenskies.com/api/auth/callback/google`) with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` as secrets. A
privacy notice (aydınlatma metni) and the account deletion button in the UI come with the start screen.

### Start screen, account settings, legal pages (done)

- Start screen (`src/ui/loading`): "[Enter] Tek başına uç" and "[O] Online uç". The online sheet (`online-panel.ts`)
  takes the start prompts' place and the title steps back: nickname (a guest account on the way, or "Google ile
  giriş"), the server list (arrow keys, 5 s refresh, "[G] Google ile kaydet" for a guest), joining, then "[Enter]
  Uçmaya başla" (the key press is the gesture pointer lock and audio need). A Google redirect reopens the sheet. Hidden
  on hosts without the API.
- Ayarlar → Hesap (`src/ui/menu/account-settings.ts`): nickname, account kind, "Google ile kaydet", sign-out, delete
  (two presses), the privacy notice and terms; while online, the server and "Sunucudan çık".
- `/legal/privacy` (KVKK aydınlatma metni) and `/legal/terms` (kullanım koşulları), static pages in `legal/`. They
  describe exactly what the code stores; any change in stored data updates them.
- Worker structure: one Hono app (`worker/index.ts`) composed from feature modules (`auth`, `account`, `rooms`,
  `probe`, `music`), shared middleware in `worker/lib` (session, same-origin, rate limits, error format), request
  bodies validated with Zod, every SQL query of a table in one repository module (`account/profiles.ts`).
- Abuse limits (Workers rate limit bindings): 10 sign-ins per IP per minute (the IP is only the counter's key), 20
  profile writes per account per minute. Better Auth also drops the Google name, photo and tokens before storage.
- `npm run test:online` (`scripts/net/online-api-test.mts`): 26 checks against `wrangler dev`: accounts, profiles,
  origin and session rules, room relay and checks, capacity, flood, the sign-in limit, deletion.
- Google OAuth client: the Web client's JSON lives in the main checkout's `.secrets/` (gitignored and in
  `.git/info/exclude`); locally its id and secret are in `.dev.vars`. It allows only
  `https://seventeenskies.com/api/auth/callback/google`, so Google sign-in is tested after deploy (or add
  `http://127.0.0.1:8799/api/auth/callback/google` to the client for local tests).

Before production: `npx wrangler d1 migrations apply seventeen-skies --remote`, the secrets `BETTER_AUTH_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (`npx wrangler secret put`), and a legal review of `/legal/privacy`
(cross-border transfer basis under KVKK article 9) before Google sign-in is announced.

### Online never pauses (done)

Rule: while online nobody's game stops, whatever the player opens.

- Menus, the map, photo mode: the engine separates a pause *request* from the *permission* (`TimeState.pauseRequested`,
  `pauseAllowed`; `paused` is both). The net system withdraws the permission while online, so the world runs on.
  With the pilot's input off (a menu open, typing in a field) and the world running, the flight autopilot holds the
  dragon on a wide 12° right-hand circle at its altitude; on the ground, perched or in the water it just waits.
  Single player keeps its pause. Measured: map open 4 s online, not paused, the dragon flew 96 m, altitude ±0.8 m.
- Hidden tab (the browser stops the frame loop): `src/net/presence.ts` sends one last snapshot flagged `away`
  (protocol flag 16) and nothing else until the tab returns. Every receiver continues that dragon on the same circle,
  computed by `src/net/loiter.ts` from the decoded snapshot (the sender uses the decoded copy too, so everyone gets
  the same numbers). On return the local dragon is placed where the circle has taken it (a `resume` teleport, not
  flagged as a jump), so nobody sees it snap. Measured end to end: back after 8 s, 0.55 m from the circle the watcher
  computed, no teleport flag. `npm run test:loiter` covers the circle and the buffer hand-over (no jump over 1 m per
  frame through away and back).

### Live map (done)

- The full map draws on two canvases: the map itself (raster, coasts, roads, pins, names) only on pan, zoom or hover,
  and a transparent live layer over it with the player's arrow and the other players, refreshed ≈15 times a second
  while the map is open (`FullMap.tick`, called by the UI every frame). Online, where the map no longer pauses the
  game, the player's arrow moves; the "where" line under the title follows once a second.
- Other players (`net.peers()`: names from the room, positions and headings from `remoteDragons.pose()`) are a
  smaller, quieter arrow than the player's own with the nickname under it; no new colour.

### Connection notices (done in branch fix/online-disconnect-notice)

One seat per account is intended: a second tab or device with the same account takes the seat and the first one
leaves the server. It used to leave silently. `src/ui/online-notices.ts` now toasts in game (one toast key, replaced in
place): another tab or device took the seat, the connection dropped and is being retried, reconnected, the server
refused or the connection ended; and other players joining ("… gökyüzüne katıldı.") and leaving. Before the game
starts the online sheet shows these itself. Testing two players needs two accounts: a private window or another
browser.

Checked on production while debugging a "cannot see the other player" report: the room relays between two accounts
(34 batches in 3 s), the joined client creates and updates the remote dragon (remote-dragons ≈0.07 ms per frame), and
locally the same join flow draws it where expected. Other players are hard to find without name tags in the world and
players on the minimap (open items).

### Steam sign-in (branch feat/steam-auth, off by default)

For the Steam build (Unreal repository, plan P7; design in its `.docs/design/online-steam.md`). The game gets a ticket
from `ISteamUser::GetAuthTicketForWebApi("seventeenskies")` and posts it as hex; the Worker verifies it on the partner
host (`ISteamUserAuth/AuthenticateUserTicket/v1`, then `ISteamUser/CheckAppOwnership/v4`) and answers a normal Better
Auth session as a bearer token. The same rooms, profiles and `/api/me` then serve Steam and web players alike.

- `worker/steam/`: `config.ts` (the flag), `web-api.ts` (the two Steam calls; key in the `x-webapi-key` header, 5 s
  timeout), `verify.ts` (policy: publisher ban refuses, VAC ban does not, ownership required, Family Sharing allowed),
  `accounts.ts` (a `user` with a placeholder e-mail on `steam.seventeenskies.com` plus an `account` row with
  providerId `steam` and the SteamID64), `native-session.ts` (Better Auth plugin: `Authorization: Bearer` read as the
  session cookie, only for requests without cookies), `routes.ts` (`POST /api/auth/sign-in/steam`, under the per-IP
  sign-in limit).
- Origin rule: a request with neither Origin nor cookies (a native client) passes the same-origin check while Steam
  sign-in is on; browsers always send Origin on writes and socket upgrades, so cookie sessions keep their protection.
- `migrations/0002_account_identity_unique.sql`: one `account` row per provider identity (the race of two first
  sign-ins).
- `npm run test:steam` (`scripts/net/steam-auth-test.mts`): the Steam client, policy, route, bearer session, origin
  rule and sign-out against a mocked Steam API, in-process on Better Auth's memory adapter.

To turn on (owner): a Steamworks app and its App ID, a publisher Web API key (Steamworks → Users & Permissions → Manage
Groups), `npx wrangler secret put STEAM_WEB_API_KEY`, `STEAM_APP_ID` and `STEAM_AUTH: "on"` in `wrangler.jsonc`, `npx
wrangler d1 migrations apply seventeen-skies --remote`, and one live probe that Steam accepts requests from Workers
(Steam refuses Workers on `steamcommunity.com/openid`; `STEAM_API_BASE` can point at a proxy if the partner host does
too). `/legal/privacy` gains the SteamID before launch.

## Stage 2 — later

Turnstile against bots, chat with moderation, persistent profiles (D1).

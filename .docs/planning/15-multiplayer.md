# Phase 15 — Multiplayer

Milestone: F · Multiplayer · Effort: L · Depends on: 14

## Goal

Flying with friends in the same Istanbul sky: seeing each other, soaring together, racing.

## Key advantage

The world is generated deterministically, so everyone gets exactly the same Istanbul. No map synchronisation is needed;
only dragon state and events travel over the network.

## Architecture

- **Server:** One Cloudflare Durable Object per room (WebSocket, authoritative room state, 20 Hz broadcast). Alternative: Node + WebSocket.
- **Messages (binary, ~60 bytes per player):** position, orientation (compressed quaternion), velocity, flight mode,
  pose parameters (wing phase, spread, neck and head), fire and attack events.
- **Client:**
  - Client-side prediction for your own dragon with server reconciliation.
  - A 100–150 ms buffer + interpolation for other players; extrapolation on packet loss.
  - Distant players at a lower rate (interest management).
- **Identity:** Anonymous sign-in with a nickname at first; accounts later.

## Scope

### Base version (M)
- Create and join rooms (invite link), ≤ 16 players per room.
- Seeing each other, name tags, players on the minimap.
- Sharing dragon and rider selection (Phase 12).
- Emotes and waving (Phase 10), preset chat messages.

### Game modes (L)
- Formation flying and follow-the-leader.
- Ring races (Phase 13 courses, multiplayer).
- Friendly duels: training attacks only (Phase 11), points instead of damage.
- Viewing together: meet on the same perch, shared photo mode.

## Security and cost

- Server-side speed and position limit checks (basic anti-cheat).
- Message rate limits, per-room bandwidth limits.
- Cost: Durable Objects bill per request and duration; with room hibernation the idle cost is ~0.

## Acceptance criteria

- In an 8-player test (4 synthetic clients) at 150 ms latency, other dragons move smoothly; no stutter or teleporting.
- Bandwidth per player ≤ 3 KB/s.
- After a disconnect, rejoining the room within 3 s.
- The local game experience is unaffected (offline mode works unchanged).

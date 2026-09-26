# Phase 03 — Viewpoints (perch system)

Milestone: B · Chill loop · Effort: M · Depends on: 01, 02

## Goal

Land the dragon on specific spots and watch the city: settle on top of a bridge tower and look over the Bosphorus,
watch the sunset from Çamlıca. The core of the chill loop.

## Viewpoints (initial list)

| Point | Type | Note |
|---|---|---|
| 15 Temmuz Şehitler Köprüsü tower top | Tower | 165 m, both shores of the Bosphorus |
| FSM Köprüsü tower top | Tower | View over Rumeli Hisarı |
| Yavuz Sultan Selim Köprüsü tower top | Tower | 322 m, highest point, Black Sea entrance |
| Galata Kulesi cap | Tower | Historic peninsula and the Golden Horn |
| Süleymaniye dome | Dome | Golden Horn and Galata |
| Kız Kulesi | Islet | At sea level, Üsküdar and Sarayburnu |
| Rumeli Hisarı, Zağanos Paşa tower | Bastion | The narrowest point of the Bosphorus |
| Büyük Çamlıca hill | Hill | Whole city, sunset |
| Otağtepe | Hill | Looking down on the FSM bridge |
| Pierre Loti hill | Hill | The classic Golden Horn view |
| Istanbul Sapphire roof | Skyscraper | Levent and the Bosphorus |
| Büyükada, Aya Yorgi hill | Hill | Princes' Islands and the Marmara |
| Aydos hill | Hill | Asian side, highest natural point |
| Yuşa Tepesi | Hill | Black Sea mouth of the Bosphorus |

## Gameplay

1. On approach a subtle marker and a "Press L to land" hint appear (distance < 400 m, slow enough).
2. Perch landing: the dragon brakes with its wings, grips with its claws, balances with its wings and wraps its tail
   around the structure (animation: [Phase 04](04-landing-takeoff-variety.md)).
3. Viewing mode:
   - The camera switches to a slow cinematic orbit; free mouse look; rider POV selectable.
   - Calm regional music starts ([Phase 07](07-regional-music.md)).
   - Stamina refills.
   - Place name and a short info text on screen.
4. Time-lapse: hold a key to watch the sunset or the city lights switching on within seconds.
5. Photo mode opens from this screen with one key.
6. Leaving: Space triggers the "drop off" takeoff (free-fall feel from [Phase 05](05-flight-feel.md)).

## Technical approach

- Contract: `PerchPoint { id, name, position, headingDeg, surface: 'tower'|'dome'|'hill'|'roof'|'rock', gripRadius, info }`.
  Points are registered into a `perches` service by the owning module (tower tops by structures, domes by mosques, hills by geo).
- Flight: new `perched` mode; approach path (align with the target, brake, automatic guidance in the last 20 m); grip
  point from the collision world's top surface.
- Camera: `perch` cinematic mode (slow orbit, framed views).
- UI: approach marker, viewing screen, info merged with the discovery card; viewpoint icons on the minimap.
- Audio and music: viewing-music trigger, wind sound fades down.

## Acceptance criteria

- The dragon can land on each of the 14 points without clipping into the structure or hovering above it.
- In viewing mode the camera orbits for 60 s without collisions; framed views approved with sunset and night screenshots.
- Time-lapse and photo mode work.
- After takeoff control returns to the player within 2 s.

## As built (awaiting the owner's feel test)

- **Code.** Flight: `src/dragon/flight/perch.ts` (`PerchDriver`, owned by `FlightSim` as `sim.perch`; one hook in
  `FlightSim.step` skips the sim's own mode code while the driver moves the body, one line at the end of
  `PoseDriver.update` lays the perched pose over the pose, `sim.teleport` resets it). No new `FlightMode`: the approach
  reads as `landing`, the perched hold as `grounded`, the drop-off's fall as `takeoff`; `DragonState.perch`
  (`DragonPerchState`, `src/core/contracts.ts`) carries the phase (`free` / `approach` / `perched` / `leaving`), the
  perch, the offered perch, refusals and aborts, and `perchAt(id)` / `leave()`. Camera: `src/camera/modes/perch-rig.ts`
  (`PerchCameraRig`), run by the cinematic mode while perched; C cycles it in `camera-system.ts`. UI:
  `src/ui/perch-view.ts` (`PerchViewing`: prompt, approach and viewing hint lines, the perch title, HUD fade, camera
  switch, time-lapse, discovery), `perchShortName` in `menu/places.ts`, the `perch` group of `CONTROL_HELP`
  ("Seyir noktaları"), `HUD_PRIORITY.perch` (45). Tunables: `PERCH`, `DROP_OFF` in `perch.ts`, `PERCH_CAMERA` in
  `perch-rig.ts`, `TIMELAPSE_SCALE` / `TIMELAPSE_RAMP` in `perch-view.ts` (nothing added to the shared `params.ts`).
- **Prompt.** Nearest perch within 260 m horizontally, airspeed ≤ 44 m/s, bearing within 70° of the direction of
  travel (ignored below 9 m/s: a hover can turn), dragon at most 160 m above / 45 m below the grip point. Hysteresis:
  it stays until 320 m, 52 m/s, 88°, 190 m / 60 m. Only in free flight without a trick; a perch just left is not
  offered again for 8 s or until 90 m away. Hint line: "[L] Kon: Galata Kulesi" (priority 45, above the hover hints).
- **Planning.** A Bézier curve from the current position (the second control point along the entry velocity, so the
  start is seamless) to the touchdown point (feet on the grip point, footprint centred on it, standing height, on the
  highest collision surface under the footprint within 0.5 m of the catalogued grip, so no foot stands below a
  collider). The final leg starts 30 m behind and 8 m above the touchdown along an arrival direction; arrivals 0°,
  ±35°, ±70°, ±110° off the perch heading, at 1×, 2.2× and 3.5× the height, first as direct curves, then through a via
  point 25 / 50 m up and 0 / ±60 / ±90 m aside. A plan must keep its acceleration under 2.6 g and its rig clearance
  spheres (body, head, tail with a curled-up pitch, spread wings, the bottom of a moderate down-stroke) 0.6 m clear of
  terrain and colliders (the margin fades over the last metres; the sea itself is no obstacle, 0.5 m above it is).
  None clear: the L press is refused ("Konma yolu kapalı" caption and the toast "Buraya şu an konulamıyor: yol kapalı.
  Biraz uzaklaşıp başka yönden yaklaş.").
- **Approach.** Duration from the curve length and the entry speed (4–16 s; a 230 m straight-in at 32 m/s takes 10 s).
  The path parameter keeps the entry pace for 45 % of the time, then slows linearly to a stop at the touchdown. Attitude
  from the path (heading along the velocity, blending into the perch heading from 55 %; path pitch; bank from the
  lateral acceleration, ≤ 40°), blended from the entry attitude over 0.7 s; the flare pitches to 32° between 60 and
  84 % and settles to 8° at the touchdown. Wings: relaxed strokes, swept forward into the flare with back-strokes; the
  amplitude is limited to the room under the wings' sweep (bank included), the spread to the room beside them (a tower
  next to the perch), and from 88 % the wings are held raised in a V. The height telemetry takes the lowest of the
  centre, head and tail over what is under each, so the tail curls up over a narrow top. Abort: a stick input > 0.55,
  Shift, Ctrl/X, Space or L again (inputs held when L was pressed count only once released), after a 0.2 s grace.
- **Perched.** The body is held on the seat: on a narrow tower cap (grip radius ≤ 2.2 m: the Galata cone) upright on
  the hind feet at the grip, nose up 24°, wrists off the stone; elsewhere on all fours, 4° nose up, 0.45 m lower than
  standing (less on a slope: the uphill legs are folded already). The body follows 0.6 of the perch surface's slope
  (terrain normal on hills, collision tops at ±1.5 m elsewhere, ≤ 22°). A temporary 'perch' cylinder collider (grip
  radius, ≤ 3 m) sits under the feet while perched and leaving, so the stance and the leap stand on the perch even
  where the landmark's colliders are lower than its mesh (the Sapphire's slanted crown) or missing (Rumeli Hisarı).
  Pose overlay (fades in over 1.4 s): tail wrapped to the side with more room and draped, neck raised with a slow look
  to either side every 5–11 s, breathing calm, reins given and the rider leaning back. Stamina refills at the ground
  rate.
- **Leaving.** Space or L. Over an edge (the surface 8 m below the feet 12 and 16 m out along a clear line; directions
  0°, ±30° … 180° off the heading, checked with the fall's spheres until the wings have room): the drop-off — a
  0.32 s crouch (wrists stand, hands raised), a 0.16 s push to 10 m/s forward and 3.2 m/s up, a fall with the wings
  half open and still until there is room for a full down-stroke (≤ 1.4 s), then the wings snap open (wing-snap sound,
  first full down-stroke) into the take-off law's drop dive. Hills, the Kız Kulesi terrace and wide tops (the Yavuz
  Sultan Selim tower head, the Süleymaniye dome): the stage A ground leap (`pickVariant`). Control returns after
  0.8 s (ground leap) or 1.35–1.75 s (drop-off).
- **Viewing mode UI.** The compass, the bottom cluster and the minimap fade out; the title zone shows the perch's name
  and info (9 s, with "Yeni seyir noktası" the first time; 5 s later); the hint line keeps "[Space] Havalan · [T]
  Zamanı hızlandır · [O] Fotoğraf · [C] Kamera: yörünge" for 14 s after perching or a viewing key, then only
  "[Space] Havalan" (and "[T] Normal zaman" while the time-lapse runs). The camera switches to the perch camera on
  perching (the rider's eyes stay if chosen) and back to the previous mode on leaving; camera toasts are silent while
  perched (the hint line names the camera). T toggles the time-lapse (36 game minutes per second, 1.6 s smooth ramps
  both ways, back to the player's own day speed); T no longer makes the rider stand while perched. O is photo mode.
- **Perch camera.** Orbit: behind and beside the dragon, drifting ±50° around the clearest azimuth (chosen among
  ±75° when the shot starts) over 84 s, elevation 13° ± 6°, boom 1.45 × the dragon's size (±8 %), looking 45 m past
  the dragon along the view and 6 m down (the dragon low in the frame, the city beyond). Fixed: the clearest azimuth
  within ±35°, 9° up, 1.3 × size. The boom is cast against the collision world every frame (1.5 m margin, at least
  3 m) and the eye pushed out of geometry (1.2 m); the mouse moves the camera around the dragon.
- **Discovery.** Perching on a perch for the first time is its discovery: the visited set is kept in localStorage
  (`ejderha.ui.perches.v1`), the `discover` sound plays, the landmark it sits on is marked discovered without its card
  (`DiscoveryTracker.markDiscovered`), and the `perch` event (`{ id, state: 'perched' | 'left', first }`) is the hook
  for progression.
- **Map / pause menu.** "Oraya kon ve izle" and a perch pin on the map teleport next to the perch and sit the dragon
  on it in the viewing mode at once (`DragonPerchState.perchAt`); the old "Konmak için [L]" toast remains the fallback
  without the flight hook. Dev hook: `window.__evrenUi.perch('galata-kulesi')`.
- **Data changes.** Kız Kulesi's grip moved from 17 to 21 m down the terrace (u = −21): at −17 the wings and the tail
  had no room between the tower and the islet's buildings. The Süleymaniye dome grip moved from 2.5 m ahead of the
  crown to 1.5 m ahead and 2.6 m to the left (the `mosque-dome` placement gained `side`): straight ahead of the crown
  the alem stood between the dragon's hind legs. `perches-check.ts` still finds both on the built surfaces.
- **Checks.** `tools/headless/perch-landing-check.ts` (real FlightSim, PoseDriver and rig over the real terrain with
  every perch landmark's colliders, `tools/headless/perch-scene.ts`): for each of the 14 perches three starts
  (straight-in from 230 m at 32 m/s, crossing from the side at 24 m/s, a hover 50 m past the perch facing away) are
  offered the perch, land it and settle within 0.5 m / 10° of the perch pose (the stance's feet on the grip point; all
  42: horizontal < 0.01 m, feet plane 0–0.35 m over the catalogued grip height (the Süleymaniye dome's collider stands
  0.35 m over the catalogued point, 0.15 m over its mesh), heading ≤ 0.1°); the flown approach keeps the clearance
  spheres clear; no skinned vertex of the body, wings or tail enters a collider or the ground (standing parts — feet,
  metatarsals, wrists, finger roots on the ground — may press 0.3 m); a stick abort returns to free flight at once
  (under 0.1 s); the take-off is airborne and controllable within 2 s and clears the structure; the perch camera
  orbits 60 s in both styles with the eye never inside geometry; the prompt state machine (reach, cone, speed, height,
  hysteresis) on 16 synthetic states. `tools/headless/perch-sheet.ts` draws the landing, sit and take-off with the
  structure (`.shots/pose/perch/`, not committed; the raster gained an optional scene overlay).
- **Not yet.** Regional viewing music (phase 07); viewpoint icons on the minimap; a subtle world-space approach
  marker (the hint line carries the prompt); Rumeli Hisarı has no fortress geometry yet (the dragon sits on the pad at
  the recorded tower height); the tail wraps in pose space only (no per-perch wrap around the structure's shape).

### Owner checklist (feel test)

1. Fly toward Galata Kulesi below ~150 km/sa: "[L] Kon: Galata Kulesi" appears once it is in front of you and within
   ~260 m; turning away or speeding up hides it, without flicker at the edges.
2. Press L: the approach feels guided but alive (no snap at the start, a clear flare, wings raised for the last
   metres), the dragon ends upright on the cone tip facing the Golden Horn, tail draped down the cap.
3. Mid-approach, press S or A: control comes back at once. Press L near the Süleymaniye dome from low between the
   minarets: either a clean approach or the polite "yol kapalı" toast, never a clip through a minaret.
4. Perched: the HUD is gone except the hint line and the title (first visit: "Yeni seyir noktası", name, info); the
   camera drifts slowly and keeps the view framed; C cycles orbit → still → rider's eyes; the mouse moves the camera.
5. T at Çamlıca in the late afternoon: the sun runs down within seconds and the city lights come on; T again eases
   back to the normal clock. O opens photo mode and closing it returns to the perch camera.
6. Space on a bridge tower: crouch, push, a short free fall with the wings still, the wings snapping open into a dive;
   you are flying again within ~2 s. On a hill the dragon leaps off the ground instead.
7. Pause menu → Işınlan → a perch ("Oraya kon ve izle") and the map's perch pins: straight into the viewing mode.
8. Check the sit on each perch type (bridge tower top, dome, cap, roof, terrace, hills) for feet on the surface and
   nothing floating or buried; sunset and night framings of the perch camera.

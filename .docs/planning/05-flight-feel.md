# Phase 05 — Flight feel: falling, g-force, thermals

Milestone: B · Chill loop · Effort: M · Depends on: 02

## Goal

The stomach-drop feeling when gliding down from a hill, the weight when pulling out of a dive, the calm of soaring on
warm air without flapping. The physics already exist; this phase makes them felt through camera, audio, effects and a wind field.

## Scope

### Falling and free fall
- Dropping off a tower or hill: 1–2 s of free fall with folded wings.
  - The camera lags slightly behind and above; cloak, straps and saddle ornaments lift.
  - Wind sound rises and thins out.
  - The wings unfold with a sharp "whoosh" and a camera shake.
- In a long dive the FOV widens, speed streaks and slight edge blur increase (extend the existing `pipeline.speedEffect`).

### G-force
- Pulling out of a dive: the camera is pressed down, the edges darken slightly, the rider leans forward, gamepad rumble.
- Negative g (sudden nose-down): a brief moment of weightlessness, loose items rise.

### Wind field: thermals and ridge lift
- Thermal columns over sunny open ground and hills in the afternoon (stronger over urban concrete, none over the sea).
- Ridge lift along the Bosphorus slopes depending on poyraz and lodos wind direction.
- The dragon can climb by soaring without flapping; storks and gulls circle in the same thermals and show where the lift
  is ([Phase 13](13-living-world.md)).
- Music swells while soaring ([Phase 07](07-regional-music.md)).

### Audio
- Wind: an upper layer that thins to a whistle with speed, a deep rumble underneath; membrane flutter during free fall.
- The wing unfold "whoosh" is tied to leaving free fall.

## Technical approach

- `EnvironmentState.liftAt(position): Vector3` (thermals + ridge lift + ambient wind), computed from geo slope, land
  use, sun angle and time of day. Flight physics consumes this field.
- Camera: spring parameters for free-fall and g-force reactions; head lag in POV.
- Post: calibration of g-force darkening and the speed effect.
- FX/model: a `looseClothLift` parameter on the model module for cloth and straps during free fall.

## Acceptance criteria

- Dropping from Otağtepe or a bridge tower: downward acceleration ≥ 7 m/s² during the first 1.5 s; camera and audio
  reactions approved from a screen recording.
- In the afternoon (t=14) over Çamlıca the dragon climbs at least 1.5 m/s without flapping; no lift over the sea.
- With poyraz, altitude can be held along the Rumeli Hisarı slope using ridge lift.
- No motion sickness: POV camera shake is adjustable and can be turned off (settings menu).

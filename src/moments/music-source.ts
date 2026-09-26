/**
 * Moment music sources, the moments side (pure TS, no DOM, no three.js): resolves a record's `musicSource` into world
 * positions for the music (src/audio/music/moment-source.ts) and finds the world source a lead-in may start from.
 *
 * - Fixed places (`at`): projected once per record with latLonToLocal, raised to the ground height plus `height`.
 * - Moving anchors (`anchor: 'ferry'`): the ferry the moment started at (its anchor id), else the nearest one in
 *   service; a ferry that leaves service mid-moment keeps its last known position.
 * - Memory: the direction of `from` (projected the same way), or none.
 *
 * Specs are cached per moment and updated in place, so the per-frame calls allocate nothing once warm.
 */
import { latLonToLocal } from '../core/geo-coords';
import { isWorldKind, WORLD_CHAINS, type MomentSourceSpec } from '../audio/music/moment-source';
import type { AnchorPoint } from './triggers';
import type { Moment, MomentMusicSource, MusicSourcePoint } from './types';

/** A moment without a `musicSource` hears its music as a memory, centred and diffuse. */
export const DEFAULT_MUSIC_SOURCE: MomentMusicSource = { kind: 'memory' };

/** Default height (m) of a memory's `from` point above the ground (the subject's body, not its foot). */
const FROM_HEIGHT = 30;
/** A fixed source this close to the coast (m) counts as by the water (the night carry over the water applies). */
const BY_WATER_M = 80;

export function musicSourceOf(m: Moment): MomentMusicSource {
  return m.content.musicSource ?? DEFAULT_MUSIC_SOURCE;
}

/** Does the moment's music come from a place in the world (a lead-in candidate)? */
export function hasWorldSource(m: Moment): boolean {
  const s = musicSourceOf(m);
  return isWorldKind(s.kind) && (s.at !== undefined || s.anchor !== undefined);
}

/** The geography the resolver reads (GeoQuery in the game, a stub in the headless check). */
export interface MusicSourceGeo {
  heightAt?(x: number, z: number): number;
  coastDistance?(x: number, z: number): number;
}

export class MusicSourceResolver {
  private readonly specs = new Map<string, MomentSourceSpec>();
  private readonly fixed = new Map<string, boolean>();

  /** Forgets the cached positions (e.g. the geography arrived). */
  clear(): void {
    this.specs.clear();
    this.fixed.clear();
  }

  private point(p: MusicSourcePoint, defHeight: number, geo: MusicSourceGeo | null): { x: number; y: number; z: number } {
    const q = latLonToLocal(p.lat, p.lon);
    const ground = geo?.heightAt ? Math.max(0, geo.heightAt(q.x, q.z)) : 0;
    return { x: q.x, y: (Number.isFinite(ground) ? ground : 0) + (p.height ?? defHeight), z: q.z };
  }

  /**
   * The music source of `m` now: `anchorId` names the moving anchor the moment started at (or the lead-in locked);
   * `near` picks the nearest anchor when no id is given. Null for an anchor source that has never seen its anchor.
   */
  resolve(m: Moment, geo: MusicSourceGeo | null, anchors?: Readonly<Record<string, readonly AnchorPoint[]>>, anchorId?: number, near?: { x: number; z: number }): MomentSourceSpec | null {
    const src = musicSourceOf(m);
    let spec = this.specs.get(m.id);
    if (!spec) {
      spec = {
        momentId: m.id,
        kind: src.kind,
        position: null,
        from: null,
        overWater: false,
        reachScale: src.reachScale ?? 1,
        musicId: m.content.musicId ?? null,
        category: m.category,
        mood: m.content.musicMood ?? [],
      };
      this.specs.set(m.id, spec);
    }
    if (!this.fixed.get(m.id) && geo) {
      // Fixed points are projected once the geography is there.
      if (src.from) {
        spec.from = this.point(src.from, FROM_HEIGHT, geo);
      }
      if (isWorldKind(src.kind) && src.at) {
        spec.position = this.point(src.at, WORLD_CHAINS[src.kind].height, geo);
        const cd = geo.coastDistance?.(spec.position.x, spec.position.z);
        spec.overWater = cd !== undefined && Number.isFinite(cd) && cd < BY_WATER_M;
      }
      this.fixed.set(m.id, true);
    }
    if (isWorldKind(src.kind) && src.anchor !== undefined) {
      spec.overWater = true;
      const list = anchors?.[src.anchor] ?? [];
      let pick: AnchorPoint | null = null;
      if (anchorId !== undefined) {
        pick = list.find((a) => a.id === anchorId) ?? null;
      } else if (near) {
        let best = Infinity;
        for (const a of list) {
          const d = (a.x - near.x) ** 2 + (a.z - near.z) ** 2;
          if (d < best) {
            best = d;
            pick = a;
          }
        }
      }
      if (pick && Number.isFinite(pick.x + pick.z)) {
        const h = src.height ?? WORLD_CHAINS[src.kind].height;
        spec.position ??= { x: 0, y: 0, z: 0 };
        spec.position.x = pick.x;
        spec.position.y = h;
        spec.position.z = pick.z;
        spec.anchorId = pick.id;
      } else if (anchorId !== undefined && spec.anchorId !== anchorId) {
        // A different anchor was asked for and is not in service: no stale position of another ferry.
        spec.position = null;
      }
      if (!spec.position) {
        return null;
      }
    }
    return spec;
  }

  /**
   * The nearest world source among `moments` within `maxDist` (m, horizontal) of `pos`, for the music's lead-in; null
   * when none is near (a few squared distances per frame, nothing else).
   */
  nearest(moments: readonly Moment[], pos: { x: number; z: number }, geo: MusicSourceGeo | null, anchors: Readonly<Record<string, readonly AnchorPoint[]>> | undefined, maxDist: number): MomentSourceSpec | null {
    if (!Number.isFinite(pos.x + pos.z)) {
      return null;
    }
    let best: MomentSourceSpec | null = null;
    let bestD = maxDist * maxDist;
    for (const m of moments) {
      if (!hasWorldSource(m)) {
        continue;
      }
      const spec = this.resolve(m, geo, anchors, undefined, pos);
      if (!spec?.position) {
        continue;
      }
      const d = (spec.position.x - pos.x) ** 2 + (spec.position.z - pos.z) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = spec;
      }
    }
    return best;
  }
}

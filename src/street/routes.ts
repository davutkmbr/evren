import type { Waypoint } from './walk-graph';

export interface StreetRoute {
  id: string;
  /** Turkish label (shown in the sandbox readout). */
  label: string;
  /** Waypoints in Evren local metres; each snaps to the walk graph and legs follow the shortest walkable path. */
  waypoints: Waypoint[];
}

/**
 * Scripted eye-level walks through compiled Kadıköy. Anchors come from .docs/research/kadikoy-hero-spots.json
 * (converted with latLonToLocal) and the OSM street centrelines in data/osm/kadikoy.json.
 */
export const STREET_ROUTES: Record<string, StreetRoute> = {
  'rihtim-carsi': {
    id: 'rihtim-carsi',
    label: 'Rıhtım → çarşı',
    waypoints: [
      { x: 336, z: 5758, label: 'Rıhtım (yeni iskelenin kuzeyi)' },
      { x: 300, z: 5818, label: 'İskele Meydanı (yeni iskele önü)' },
      { x: 318, z: 5872, label: 'Haldun Taner Sahnesi önü' },
      { x: 380, z: 6018, label: 'Yasa Cd' },
      { x: 442, z: 6054, label: 'Güneşlibahçe Sk başı' },
      { x: 396, z: 6130, label: 'Güneşlibahçe Sk (balıkçılar)' },
      { x: 350, z: 6210, label: 'Güneşlibahçe Sk / Dumlupınar Sk' },
    ],
  },
  'altiyol-sureyya': {
    id: 'altiyol-sureyya',
    label: 'Altıyol → Bahariye → Süreyya',
    waypoints: [
      { x: 747, z: 6040, label: 'Altıyol' },
      { x: 768, z: 6072, label: 'Boğa Heykeli' },
      { x: 752, z: 6120, label: 'Bahariye Cd başı' },
      { x: 736, z: 6230, label: 'Bahariye Cd' },
      { x: 732, z: 6330, label: 'Süreyya Operası önü' },
    ],
  },
};

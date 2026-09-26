/**
 * City life and nature (phase 19 backlog items 2 and 4). Player-facing text is Turkish and our own writing.
 */
import type { LatLon, Moment } from '../types';
import { original } from './provenance';

/**
 * Rough corridor over the Bosphorus from Sarayburnu to the Black Sea mouth, both shores included (shared with the shore
 * poem). moments-runtime-check verifies that it covers the strait's water in world coordinates.
 */
export const BOSPHORUS_CORRIDOR: readonly LatLon[] = [
  { lat: 41.0, lon: 28.97 },
  { lat: 41.0, lon: 29.05 },
  { lat: 41.075, lon: 29.085 },
  { lat: 41.21, lon: 29.16 },
  { lat: 41.24, lon: 29.17 },
  { lat: 41.24, lon: 29.07 },
  { lat: 41.21, lon: 29.05 },
  { lat: 41.07, lon: 29.0 },
];

export const storks: Moment = {
  id: 'storks-bosphorus-migration',
  title: "Boğaz'da Leylek Göçü",
  category: 'city-life',
  status: 'draft',
  backlog: 2,
  trigger: {
    place: { label: 'Bosphorus corridor', area: BOSPHORUS_CORRIDOR },
    surface: 'air',
    altitude: [{ ref: 'asl', min: 150, max: 1500 }],
    dateRange: { from: { month: 8, day: 15 }, to: { month: 10, day: 15 } },
    timeOfDay: { from: 9, to: 17 },
    weather: ['clear', 'haze'],
    repeat: { kind: 'repeatable', cooldownSec: 1800 },
  },
  content: {
    actorId: 'moments/white-stork-flock',
    animationIds: ['moments/stork-soar-circle', 'moments/stork-glide'],
    soundId: 'moments/stork-bill-clatter',
    subtitles: [
      { at: 0, duration: 4.5, text: "Leylekler! Her güz Avrupa'dan Afrika'ya giderken Boğaz'dan geçerler." },
      { at: 5, duration: 4, text: 'Denizin üstünde termik azdır; o yüzden en dar geçidi seçerler.' },
      { at: 9.5, duration: 4, text: 'Daire çizip yükseliyorlar. Katıl onlara, sıcak hava bedava.' },
    ],
    camera: { kind: 'orbit', note: 'Flock circling in a thermal column; the dragon may join the spiral.' },
    card: {
      title: "Boğaz'dan Göç",
      text:
        'Her sonbahar yüz binlerce leylek ve yırtıcı kuş Boğaz üzerinden Afrika\'ya göç eder. Uzun deniz geçişlerinden ' +
        'kaçınıp karanın üstündeki sıcak hava akımlarıyla süzülürler.',
    },
  },
  provenance: [original('subtitles', 'White stork and raptor migration over the Bosphorus (natural history)'), original('card', 'White stork and raptor migration over the Bosphorus (natural history)')],
  needs: ['model', 'animation', 'sound'],
  notes:
    'White storks peak from mid-August to mid-September, raptors continue into October; the range 15 Aug – 15 Oct covers both. ' +
    'Joining the thermal needs phase 05 lift; the runtime should place the flock over land near the strait (Çamlıca, Sarıyer hills).',
};

export const gullSimit: Moment = {
  id: 'ferry-gull-simit',
  title: 'Martı ve Simit',
  category: 'city-life',
  status: 'draft',
  backlog: 4,
  trigger: {
    place: { label: 'Near any ferry (moving anchor)', anchor: 'ferry', radius: 60 },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 40 }],
    timeOfDay: { from: 7, to: 21 },
    weather: ['clear', 'haze', 'fog'],
    repeat: { kind: 'repeatable', cooldownSec: 600 },
  },
  content: {
    actorId: 'moments/ferry-passenger-and-gull',
    animationIds: ['moments/passenger-raise-simit', 'moments/gull-snatch', 'moments/passenger-shrug'],
    soundId: 'moments/gull-call',
    subtitles: [
      { at: 0, duration: 3.5, text: 'Vapurda biri simidini havaya kaldırdı. Büyük hata.' },
      { at: 4, duration: 3, text: 'Martı hiç düşünmedi. Simit artık onun.' },
      { at: 7.5, duration: 3, speaker: 'Martı', text: 'Çay da var mıydı?' },
    ],
    camera: { kind: 'look-at', note: 'Stern of the ferry, passenger holding a simit, gull diving in from the wake.' },
    card: {
      title: 'Martı ve Simit',
      text: "İstanbul vapurlarının değişmeyen sahnesi: simit parçaları ve onları havada kapan martılar. Martılar bu işte hiç ıskalamaz.",
    },
  },
  provenance: [original('subtitles'), original('card')],
  needs: ['model', 'animation', 'sound', 'runtime-anchor'],
  notes: "Needs the ferries' positions as the 'ferry' anchor (living world, phase 13). The dragon may snatch the simit too (future gameplay).",
};

export const anglers: Moment = {
  id: 'galata-bridge-anglers',
  title: 'Galata Köprüsü Oltacıları',
  category: 'city-life',
  status: 'draft',
  backlog: 4,
  trigger: {
    place: { label: 'Galata Bridge upper deck', center: { lat: 41.0198, lon: 28.9733 }, radius: 220 },
    surface: 'air',
    altitude: [{ ref: 'agl', max: 25 }],
    timeOfDay: { from: 6, to: 22 },
    weather: ['clear', 'haze', 'fog', 'rain'],
    repeat: { kind: 'repeatable', cooldownSec: 240 },
  },
  content: {
    actorId: 'moments/galata-anglers',
    animationIds: ['moments/angler-hold-hat', 'moments/angler-shake-fist', 'moments/angler-recast'],
    soundId: 'moments/anglers-reel-and-shout',
    subtitles: [
      { at: 0, duration: 3.5, text: 'Galata Köprüsü\'nde oltacılar şapkalarına sarıldı.' },
      { at: 4, duration: 3.5, speaker: 'Oltacı', text: 'Yavaş be evladım, istavritler kaçıyor!' },
      { at: 8, duration: 3.5, speaker: 'Oltacı', text: 'Önce bir balık tut, sonra hava atarsın.' },
    ],
    camera: { kind: 'look-at', waypoint: 'deck', note: 'Row of anglers along the railing, rods bending, hats held down by the downwash.' },
    card: {
      title: 'Galata Köprüsü Oltacıları',
      text: "Köprünün korkuluğu boyunca sabahtan akşama olta sallayanlar İstanbul'un en sabırlı insanlarıdır. En çok istavrit çıkar.",
    },
    waypoints: [{ id: 'deck', lat: 41.0198, lon: 28.9733, note: 'Middle of the upper deck', nearLandmark: 'galata-koprusu' }],
  },
  provenance: [original('subtitles'), original('card')],
  needs: ['model', 'animation', 'sound'],
  notes: 'The low flyover should also ruffle clothes and hats (street crowd system); this record only covers the lines.',
};

export const CITY_LIFE: readonly Moment[] = [storks, gullSimit, anglers];

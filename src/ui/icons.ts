/** Hand-drawn inline SVG icons (24px grid, 1.6 stroke, currentColor). */

const wrap = (body: string, size = 24): string =>
  `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  sun: wrap('<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
  sunset: wrap('<path d="M4 17.5h16M7 17.5a5 5 0 0 1 10 0M12 6.5v3M5.9 10.4l1.6 1.4M18.1 10.4l-1.6 1.4M8 21h8"/>'),
  moon: wrap('<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z"/>'),
  camera: wrap('<path d="M4 8.5h3l1.6-2.3h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.3"/>'),
  eye: wrap('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
  compass: wrap('<circle cx="12" cy="12" r="8.6"/><path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9z"/>'),
  play: wrap('<path d="M8.2 5.8v12.4L18 12z"/>'),
  sliders: wrap('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  pin: wrap('<path d="M12 21s6.5-5.8 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.2 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
  keyboard: wrap('<rect x="2.8" y="6.5" width="18.4" height="11" rx="2"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>'),
  plus: wrap('<path d="M12 5.5v13M5.5 12h13"/>'),
  minus: wrap('<path d="M5.5 12h13"/>'),
  locate: wrap('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>'),
  close: wrap('<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>'),
  map: wrap('<path d="m9 4.5-5.5 2v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>'),
  sparkle: wrap('<path d="M12 3.5 13.9 10 20.5 12l-6.6 2L12 20.5 10.1 14 3.5 12l6.6-2z"/>'),
  aperture: wrap('<circle cx="12" cy="12" r="8.6"/><path d="M14.5 3.8 9.2 13M20.3 10.4l-10.6.1M17.1 18.7 11.5 9.6M9.5 20.2l5.3-9.2M3.7 13.6l10.6-.1M6.9 5.3l5.6 9.1"/>'),
} as const;

/** Heading-up player arrow for the minimap and full map (points up, centred on 0,0 of a 32 box). */
export const PLAYER_ARROW = `<svg viewBox="-16 -16 32 32" width="32" height="32" aria-hidden="true"><path d="M0 -11 L8 9 L0 4.6 L-8 9 Z" fill="#fff6e8" stroke="rgba(10,12,16,0.75)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

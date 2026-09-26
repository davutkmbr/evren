import type { HotbarIcon } from '../../core/contracts';

/** Inline stroke icons for hotbar slots (24px grid, 1.8 stroke, round caps), each with its own tint. */

const icon = (body: string, stroke: string, size = 24): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const HOTBAR_ICONS: Record<HotbarIcon, string> = {
  fire: icon('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>', '#f6c27a'),
  roar: icon('<path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>', '#f6f1e7'),
  potion: icon('<path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 14h9"/>', '#bfe3d0', 22),
  feather: icon('<path d="M19 4c-6 0-11 4-12 11l-2 5M7 15h6M9 11h6c-1 3-3 5-6 5M19 4c0 4-2 7-4 7"/>', '#f6f1e7', 22),
  lantern: icon('<path d="M9 5h6M12 3v2M8 8h8l-1 10H9zM8 8l1-3h6l1 3M10 21h4M12 12v3"/>', '#f6c27a', 22),
  gift: icon('<path d="M4 10h16v3H4zM5 13v7h14v-7M12 10v10M12 10c-2-4-6-4-6-1.5S10 10 12 10zM12 10c2-4 6-4 6-1.5S14 10 12 10z"/>', '#e8b872', 22),
  unknown: icon('<path d="M9.5 9a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.8M12 17.5h.01"/><circle cx="12" cy="12" r="8.5"/>', 'rgba(246,241,231,0.7)', 22),
};

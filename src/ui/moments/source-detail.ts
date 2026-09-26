/**
 * The content of a moment's sources, shared by the source sheet ("[I] Kaynağa bak") and the pause menu's Anlar tab:
 * title, author, the quoted excerpt (the subtitle lines together), the card text and the list of sources.
 *
 * Privacy: nothing third-party exists in the DOM until `show()` runs (the player opened the source), and `clear()`
 * removes it again (a closed sheet stops the video and makes no further requests). Only approved items are embedded
 * (src/moments/sources.ts, sourceEmbed): the YouTube player through youtube-nocookie.com, sandboxed, without autoplay;
 * an image with its attribution and licence. Every item is also a key-first "Tarayıcıda aç" link with its domain.
 * Offline, embeds are replaced by a calm note.
 */
import { momentAuthorLine, momentExcerpt, sourceDomain, sourceEmbed, visibleSources, youtubeEmbedUrl } from '../../moments/sources';
import type { Moment, MomentCategory, MomentSource, MomentSourceKind } from '../../moments/types';
import { linkPrompt, type LinkPrompt } from '../components';
import { el } from '../dom';
import './moments-ui.css';

const CATEGORY_LABEL: Record<MomentCategory, string> = {
  legend: 'Efsane',
  'city-life': 'Şehir hayatı',
  poem: 'Şiir',
};

const KIND_LABEL: Record<MomentSourceKind, string> = {
  text: 'Metin',
  image: 'Görsel',
  video: 'Video',
  audio: 'Ses',
  link: 'Bağlantı',
};

const OFFLINE_TEXT = 'Şu an çevrimdışısın. Kaynaklar internet bağlantısı gelince açılır; bağlantılar tarayıcıda yine denenebilir.';
const IMAGE_FAILED_TEXT = 'Görsel şu an yüklenemedi. Sayfasını tarayıcıda açabilirsin.';
const NO_SOURCES_TEXT = 'Bu anın kaynakları henüz eklenmedi.';

/** Links get the keys 1–9 in list order (the game is paused behind the sheet, so the hotbar keys are free). */
const MAX_LINK_KEYS = 9;

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export class MomentSourceDetail {
  readonly root = el('article', 'msrc');
  private links: LinkPrompt[] = [];
  private moment: Moment | null = null;

  get current(): Moment | null {
    return this.moment;
  }

  /** Renders `m`; approved embeds are created now (the player asked for the source). */
  show(m: Moment): void {
    this.clear();
    this.moment = m;
    const author = momentAuthorLine(m);
    const meta = [CATEGORY_LABEL[m.category], author].filter(Boolean).join(' · ');
    const nodes: HTMLElement[] = [el('h2', 'msrc-title', m.title), el('p', 'msrc-meta', meta)];

    const lines = momentExcerpt(m);
    if (lines.length > 0) {
      nodes.push(el('blockquote', 'msrc-excerpt', lines.map((l) => el('span', 'msrc-excerpt-line', l))));
    }
    const card = m.content.card;
    if (card) {
      nodes.push(el('section', 'msrc-card', [el('h3', 'msrc-card-title', card.title), el('p', 'msrc-card-text', card.text)]));
    }

    const sources = visibleSources(m);
    nodes.push(el('h3', 'msrc-heading', 'Kaynaklar'));
    if (sources.length === 0) {
      nodes.push(el('p', 'msrc-note', NO_SOURCES_TEXT));
    } else {
      const isOnline = online();
      if (!isOnline && sources.some((s) => sourceEmbed(s))) {
        nodes.push(el('p', 'msrc-note msrc-offline', OFFLINE_TEXT));
      }
      nodes.push(el('ul', 'msrc-list', sources.map((s, i) => this.item(s, i, isOnline))));
    }
    this.root.replaceChildren(...nodes);
    this.root.scrollTop = 0;
  }

  /** Removes everything (embeds included: the player stops, no further requests). */
  clear(): void {
    this.moment = null;
    this.links = [];
    this.root.replaceChildren();
  }

  /** Digit keys open the matching link in a new tab. */
  handleKey(e: KeyboardEvent): boolean {
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (!digit || e.repeat) {
      return false;
    }
    const link = this.links[Number(digit[1]) - 1];
    if (!link) {
      return false;
    }
    link.open();
    return true;
  }

  private item(s: MomentSource, index: number, isOnline: boolean): HTMLElement {
    const credit = [s.attribution, s.licence].filter(Boolean).join(' · ');
    const children: Array<HTMLElement | null> = [
      el('div', 'msrc-item-head', [el('span', 'msrc-kind', KIND_LABEL[s.kind]), el('span', 'msrc-item-title', s.title)]),
      credit ? el('p', 'msrc-credit', credit) : null,
    ];
    const embed = sourceEmbed(s);
    if (embed && isOnline) {
      if (embed.kind === 'youtube') {
        const frame = el('iframe', 'msrc-frame', undefined, {
          src: youtubeEmbedUrl(embed),
          title: s.title,
          loading: 'lazy',
          referrerpolicy: 'strict-origin-when-cross-origin',
          allow: 'encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: true,
          sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
        });
        children.push(el('div', 'msrc-video', [frame]));
      } else {
        const img = el('img', 'msrc-img', undefined, {
          src: embed.src,
          alt: s.title,
          width: embed.width,
          height: embed.height,
          loading: 'lazy',
          decoding: 'async',
          referrerpolicy: 'no-referrer',
        });
        const figure = el('figure', 'msrc-figure', [img, credit ? el('figcaption', 'msrc-credit', credit) : null]);
        img.addEventListener('error', () => figure.replaceChildren(el('p', 'msrc-note', IMAGE_FAILED_TEXT)), { once: true });
        children.push(figure);
      }
    }
    const key = index < MAX_LINK_KEYS ? String(index + 1) : '';
    const link = linkPrompt('Tarayıcıda aç', key, s.url, sourceDomain(s.url));
    this.links.push(link);
    children.push(el('div', 'msrc-actions', [link.root]));
    return el('li', 'msrc-item', children);
  }
}

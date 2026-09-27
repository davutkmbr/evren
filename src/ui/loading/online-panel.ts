import type { AccountService, GameServerInfo, NetService } from '../../core/contracts';
import { linkPrompt, listRow, prompt, textField, type ListRow, type Prompt } from '../components';
import { el } from '../dom';

export interface OnlinePanelOptions {
  account: AccountService;
  net: NetService;
  /** Joined, and the player pressed start (a user gesture: pointer lock and audio need one). */
  onStart(): void;
  /** Back to the start choice. */
  onBack(): void;
}

type Step = 'name' | 'servers' | 'joining' | 'joined';

/** Set before the Google redirect, so the panel opens again when the page comes back signed in. */
export const RESUME_KEY = 'evren.online.resume';
const REFRESH_MS = 5000;
const count = new Intl.NumberFormat('tr-TR');

const NAME_RULE = '2–16 karakter: harf, rakam, boşluk, _ . -';
const ERRORS: Record<string, string> = {
  full: 'Sunucu dolu. Başka birini seç.',
  lost: 'Bağlantı kurulamadı. Biraz sonra tekrar dene.',
  replaced: 'Bu hesapla başka bir yerden bağlanıldı.',
  version: 'Oyun güncellendi. Sayfayı yenile.',
  'signed-out': 'Oturumun kapanmış. Takma adınla yeniden başla.',
  'no-profile': 'Önce bir takma ad seç.',
};

/**
 * "Online uç" on the start screen: a small sheet in place of the start prompts. Steps: the nickname (a guest account
 * is made on the way, or Google), the server list with player counts, joining, and once the server has welcomed us
 * "[Enter] Uçmaya başla" (the key press is the gesture the game needs to take the pointer and start audio). Keys: Enter continues or joins, arrows move in the list, N renames, G links Google, R refreshes,
 * Esc goes back. Keys are ignored while the nickname field has focus (it takes the letters).
 */
export class OnlinePanel {
  readonly root: HTMLElement;
  private step: Step = 'name';
  private readonly body = el('div', 'ld-online-body');
  private readonly message = el('p', 'ld-online-msg', undefined, { role: 'status' });
  private readonly field = textField('Takma ad', { size: 'l', maxLength: 16, placeholder: 'Örneğin Göktürk' });
  private servers: GameServerInfo[] = [];
  private rows: ListRow[] = [];
  private selected = 0;
  private refreshTimer = 0;
  private busy = false;
  private unsubscribe: (() => void)[] = [];
  private primary: Prompt | null = null;

  constructor(private readonly options: OnlinePanelOptions) {
    const back = prompt('Geri', 'Esc', 'secondary', () => this.back());
    this.root = el('section', 'ld-online', [el('header', 'ld-online-head', [el('h2', 'ld-online-title', 'Online uç'), back.root]), this.body, this.message], {
      'aria-label': 'Online uç',
    });
    // Clicks inside the sheet must not reach the loading screen (a click there starts single player).
    this.root.addEventListener('click', (e) => e.stopPropagation());
    this.field.input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        void this.submitName();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.back();
      }
      e.stopPropagation();
    });
    this.unsubscribe.push(options.net.onChange(() => this.onNet()));
  }

  /** Shows the right first step for the account (checks the session first). */
  async open(): Promise<void> {
    this.setMessage('');
    const { account } = this.options;
    if (account.status === 'unknown') {
      await account.refresh();
    }
    if (account.nickname) {
      this.showServers();
    } else {
      this.showName();
    }
  }

  /** Keyboard while the sheet is shown; true when the key was used. */
  handleKey(e: KeyboardEvent): boolean {
    if (document.activeElement === this.field.input) {
      return false;
    }
    const code = e.code;
    if (code === 'Escape') {
      this.back();
      return true;
    }
    if (this.step === 'name' && (code === 'Enter' || code === 'NumpadEnter')) {
      void this.submitName();
      return true;
    }
    if (this.step === 'joined' && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) {
      this.options.onStart();
      return true;
    }
    if (this.step !== 'servers') {
      return false;
    }
    switch (code) {
      case 'ArrowDown':
      case 'ArrowUp':
        this.select(this.selected + (code === 'ArrowDown' ? 1 : -1));
        return true;
      case 'Enter':
      case 'NumpadEnter':
        this.join();
        return true;
      case 'KeyN':
        this.showName(true);
        return true;
      case 'KeyR':
        void this.loadServers();
        return true;
      case 'KeyG':
        if (this.options.account.user?.guest && this.options.account.googleAvailable) {
          void this.google();
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private showName(renaming = false): void {
    this.step = 'name';
    this.stopRefresh();
    const { account } = this.options;
    this.field.input.value = account.nickname ?? '';
    this.field.setMessage(NAME_RULE);
    this.primary = prompt(renaming ? 'Kaydet' : 'Devam et', 'Enter', 'primary', () => void this.submitName());
    const actions = [this.primary.root];
    if (!renaming && account.googleAvailable && account.status !== 'signed-in') {
      actions.push(prompt('Google ile giriş', '', 'secondary', () => void this.google()).root);
    }
    if (renaming) {
      actions.push(prompt('Vazgeç', '', 'secondary', () => this.showServers()).root);
    }
    this.body.replaceChildren(
      el('p', 'ld-online-lede', renaming ? 'Yeni takma adın diğer oyunculara görünür.' : 'Diğer oyuncularla aynı gökte uç. Takma adın onlara görünür.'),
      this.field.root,
      el('div', 'ld-online-actions', actions),
      el('p', 'ld-online-legal', [
        el('span', undefined, 'Hesabın bu tarayıcıda saklanır.'),
        linkPrompt('Gizlilik metni', '', '/legal/privacy', '').root,
        linkPrompt('Kullanım koşulları', '', '/legal/terms', '').root,
      ]),
    );
    requestAnimationFrame(() => this.field.input.focus({ preventScroll: true }));
  }

  private async submitName(): Promise<void> {
    if (this.busy) {
      return;
    }
    const { account } = this.options;
    const name = this.field.input.value;
    this.busy = true;
    this.primary?.setDisabled(true);
    this.field.setMessage('Kaydediliyor…');
    const result = account.status === 'signed-in' ? await account.setNickname(name) : await account.playAsGuest(name);
    this.busy = false;
    this.primary?.setDisabled(false);
    if (result === 'ok') {
      this.field.input.blur();
      this.showServers();
      return;
    }
    this.field.setMessage(
      result === 'invalid' ? NAME_RULE : result === 'taken' ? 'Bu ad alınmış. Başka bir ad dene.' : 'Kaydedilemedi. Bağlantını kontrol edip tekrar dene.',
      'warn',
    );
    this.field.input.focus({ preventScroll: true });
  }

  private showServers(): void {
    this.step = 'servers';
    const { account } = this.options;
    const who = el('div', 'ld-online-who', [el('p', 'ld-online-lede', [el('b', undefined, account.nickname ?? ''), ' olarak uçacaksın']), prompt('Adı değiştir', 'N', 'secondary', () => this.showName(true)).root]);
    const guest =
      account.user?.guest && account.googleAvailable
        ? el('p', 'ld-online-note', ['Misafir hesabın yalnızca bu tarayıcıda. ', prompt('Google ile kaydet', 'G', 'secondary', () => void this.google()).root])
        : null;
    const list = el('div', 'ld-online-list', undefined, { role: 'listbox', 'aria-label': 'Sunucular' });
    this.primary = prompt('Katıl', 'Enter', 'primary', () => this.join());
    this.body.replaceChildren(
      who,
      guest ?? '',
      list,
      el('div', 'ld-online-actions', [this.primary.root, prompt('Yenile', 'R', 'secondary', () => void this.loadServers()).root]),
    );
    void this.loadServers();
    this.stopRefresh();
    this.refreshTimer = window.setInterval(() => void this.loadServers(), REFRESH_MS);
  }

  private async loadServers(): Promise<void> {
    const list = this.body.querySelector('.ld-online-list');
    if (!list || this.step !== 'servers') {
      return;
    }
    try {
      this.servers = await this.options.net.listServers();
    } catch {
      this.servers = [];
      this.setMessage('Sunucu listesi alınamadı. Yenile ile tekrar dene.', 'warn');
    }
    if (this.step !== 'servers') {
      return;
    }
    const previous = this.servers[this.selected]?.id;
    this.rows = this.servers.map((s, i) =>
      listRow(
        { label: s.name, sub: s.players >= s.max ? 'Dolu' : s.players === 0 ? 'Henüz kimse yok' : `${count.format(s.players)} oyuncu`, value: `${count.format(s.players)} / ${count.format(s.max)}` },
        () => {
          this.select(i);
          this.join();
        },
        () => this.select(i),
      ),
    );
    list.replaceChildren(...this.rows.map((r) => r.root));
    const keep = this.servers.findIndex((s) => s.id === previous);
    const firstOpen = this.servers.findIndex((s) => s.players < s.max);
    this.select(keep >= 0 ? keep : Math.max(0, firstOpen));
    this.primary?.setDisabled(!this.servers.length);
  }

  private select(i: number): void {
    if (!this.rows.length) {
      return;
    }
    this.selected = (i + this.rows.length) % this.rows.length;
    this.rows.forEach((r, j) => r.setSelected(j === this.selected));
  }

  private join(): void {
    const server = this.servers[this.selected];
    if (!server || this.step !== 'servers') {
      return;
    }
    if (server.players >= server.max) {
      this.setMessage(ERRORS.full, 'warn');
      return;
    }
    this.step = 'joining';
    this.stopRefresh();
    this.setMessage('');
    this.body.replaceChildren(el('p', 'ld-online-lede', `${server.name} sunucusuna bağlanılıyor…`));
    this.options.net.join(server);
  }

  private onNet(): void {
    if (this.step !== 'joining') {
      return;
    }
    const { net } = this.options;
    if (net.status === 'online') {
      this.showJoined();
    } else if (net.status === 'offline') {
      const error = net.lastError ?? 'lost';
      if (error === 'signed-out' || error === 'no-profile') {
        this.showName();
      } else {
        this.showServers();
      }
      this.setMessage(ERRORS[error] ?? ERRORS.lost, 'warn');
    }
  }

  private showJoined(): void {
    this.step = 'joined';
    const { net } = this.options;
    const others = net.players.size;
    const start = prompt('Uçmaya başla', 'Enter', 'primary', () => this.options.onStart());
    start.root.classList.add('ld-cta');
    this.body.replaceChildren(
      el('p', 'ld-online-lede', [
        el('b', undefined, net.server?.name ?? ''),
        others ? ` sunucusundasın. Gökte ${count.format(others)} oyuncu daha var.` : ' sunucusundasın. Şimdilik gökte yalnızsın.',
      ]),
      el('div', 'ld-online-actions', [start.root]),
    );
    requestAnimationFrame(() => start.root.focus({ preventScroll: true }));
  }

  private async google(): Promise<void> {
    try {
      sessionStorage.setItem(RESUME_KEY, '1');
    } catch {
      // Private mode: the panel just does not reopen by itself.
    }
    await this.options.account.signInWithGoogle();
  }

  private back(): void {
    if (this.step === 'joining' || this.step === 'joined') {
      this.options.net.leave();
      this.showServers();
      return;
    }
    this.close();
    this.options.onBack();
  }

  private setMessage(text: string, tone: 'quiet' | 'warn' = 'quiet'): void {
    this.message.textContent = text;
    this.message.hidden = !text;
    this.message.classList.toggle('is-warn', tone === 'warn');
  }

  private stopRefresh(): void {
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = 0;
  }

  close(): void {
    this.stopRefresh();
  }

  dispose(): void {
    this.stopRefresh();
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
  }
}

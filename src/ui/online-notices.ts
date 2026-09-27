import type { NetService } from '../core/contracts';
import type { Toasts } from './overlays/toasts';

/** Toast key: every online notice replaces the previous one in place instead of queueing. */
const KEY = 'online';

const ENDED: Record<string, string> = {
  replaced: 'Bu hesapla başka bir sekmeden ya da cihazdan katıldın; bu sekme sunucudan çıktı.',
  full: 'Sunucu doldu; bu sekme sunucudan çıktı.',
  version: 'Oyun güncellendi; online uçmak için sayfayı yenile.',
  'signed-out': 'Oturumun kapandı; sunucudan çıktın.',
  'no-profile': 'Takma adın bulunamadı; sunucudan çıktın.',
  lost: 'Sunucu bağlantısı koptu. Online uçmak için menüden yeniden katıl.',
};

/**
 * In-game notices about the connection (phase 26): other players joining and leaving, a dropped connection being
 * retried, and why the game left the server (another tab took the account's seat, the connection was lost ...).
 * Before the game starts the start screen's online sheet shows these itself, so nothing is toasted then.
 */
export class OnlineNotices {
  private status: NetService['status'];
  private known = new Map<number, string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly net: NetService,
    private readonly toasts: Toasts,
    private readonly started: () => boolean,
  ) {
    this.status = net.status;
    this.unsubscribe = net.onChange(() => this.onChange());
  }

  private onChange(): void {
    const net = this.net;
    const was = this.status;
    this.status = net.status;
    const live = this.started();
    if (net.status === 'online') {
      if (live && was === 'connecting' && net.lastError === null && this.known.size) {
        this.toasts.push('Yeniden bağlandın.', 'info', KEY);
      }
      this.diffPlayers(live && was === 'online');
      return;
    }
    this.known.clear();
    if (!live) {
      return;
    }
    if (net.status === 'connecting' && was === 'online') {
      this.toasts.push('Sunucu bağlantısı koptu, yeniden bağlanılıyor…', 'warn', KEY);
    } else if (net.status === 'offline' && was !== 'offline' && net.lastError) {
      this.toasts.push(ENDED[net.lastError] ?? ENDED.lost, 'warn', KEY);
    }
  }

  /** Joins and leaves since the last change; the players already there on joining are not announced. */
  private diffPlayers(announce: boolean): void {
    const now = this.net.players;
    if (announce) {
      for (const [id, name] of now) {
        if (!this.known.has(id)) {
          this.toasts.push(`${name} gökyüzüne katıldı.`, 'info', KEY);
        }
      }
      for (const [id, name] of this.known) {
        if (!now.has(id)) {
          this.toasts.push(`${name} ayrıldı.`, 'info', KEY);
        }
      }
    }
    this.known = new Map(now);
  }

  dispose(): void {
    this.unsubscribe();
  }
}

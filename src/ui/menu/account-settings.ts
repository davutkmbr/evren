import type { AccountService, NetService } from '../../core/contracts';
import { linkPrompt, prompt, settingRow, settingSection, textField } from '../components';
import { el } from '../dom';

const count = new Intl.NumberFormat('tr-TR');
const CONFIRM_MS = 4000;

/**
 * Ayarlar → Hesap: the nickname, the account kind ("Google ile kaydet" for a guest), sign-out, account deletion (two
 * presses), the privacy notice and the terms; while online, the server and "Sunucudan çık". The account part is
 * rebuilt when the account changes, the online part when the connection or its players change (a nickname being typed
 * survives players joining).
 */
export class AccountSettings {
  private readonly accountBox = el('div', 'set-account-main');
  private readonly onlineBox = el('div', 'set-account-online');
  readonly root = el('div', 'set-account', [this.accountBox, this.onlineBox]);
  private unsubscribe: (() => void)[] = [];
  private account: AccountService | undefined;
  private net: NetService | undefined;

  constructor() {
    this.render();
  }

  /** The services arrive after the UI is built (the UI system initialises first). */
  setAccount(account: AccountService): void {
    this.account = account;
    this.unsubscribe.push(account.onChange(() => this.render()));
    this.render();
  }

  setNet(net: NetService): void {
    this.net = net;
    this.unsubscribe.push(net.onChange(() => this.renderOnline()));
    this.renderOnline();
  }

  private render(): void {
    const a = this.account;
    const privacy = settingRow('Gizlilik metni', 'Hangi bilgilerin neden saklandığı ve hakların', linkPrompt('Aç', '', '/legal/privacy', '').root);
    const terms = settingRow('Kullanım koşulları', 'Online oynarken uyulacak kurallar', linkPrompt('Aç', '', '/legal/terms', '').root);
    if (!a || a.status === 'unknown') {
      this.accountBox.replaceChildren(settingSection('Hesap', [settingRow('Hesap', 'Hesap bilgisine şu an ulaşılamıyor.', el('span')), privacy, terms]));
      return;
    }
    if (a.status === 'signed-out') {
      const rows = [settingRow('Hesap', 'Online uçtuğunda bir misafir hesap açılır; takma adın diğer oyunculara görünür.', el('span'))];
      if (a.googleAvailable) {
        rows.push(settingRow('Google ile giriş', 'Hesabın her cihazda seninle olur', prompt('Giriş yap', '', 'secondary', () => void a.signInWithGoogle()).root));
      }
      rows.push(privacy, terms);
      this.accountBox.replaceChildren(settingSection('Hesap', rows));
      return;
    }

    const field = textField('Takma ad', { maxLength: 16 });
    field.input.value = a.nickname ?? '';
    // The field takes letters that are shortcuts elsewhere in the menu.
    field.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        void save();
      }
    });
    const saveButton = prompt('Kaydet', '', 'secondary', () => void save());
    const save = async (): Promise<void> => {
      saveButton.setDisabled(true);
      const result = await a.setNickname(field.input.value);
      saveButton.setDisabled(false);
      field.setMessage(
        result === 'ok' ? 'Kaydedildi' : result === 'taken' ? 'Bu ad alınmış' : result === 'invalid' ? '2–16 karakter: harf, rakam, boşluk, _ . -' : 'Kaydedilemedi',
        result === 'ok' ? 'quiet' : 'warn',
      );
    };

    const kind = a.user?.guest
      ? settingRow(
          'Hesap türü',
          'Misafir: yalnızca bu tarayıcıda saklanır',
          a.googleAvailable ? prompt('Google ile kaydet', '', 'secondary', () => void a.signInWithGoogle()).root : el('span'),
        )
      : settingRow('Hesap türü', `Google: ${a.user?.email ?? ''}`, el('span'));

    let armed = 0;
    const del = prompt('Sil', '', 'danger', () => {
      if (!armed) {
        del.setLabel('Emin misin? Tekrar bas');
        armed = window.setTimeout(() => {
          armed = 0;
          del.setLabel('Sil');
        }, CONFIRM_MS);
        return;
      }
      window.clearTimeout(armed);
      armed = 0;
      this.net?.leave();
      void a.deleteAccount();
    });

    this.accountBox.replaceChildren(
      settingSection('Hesap', [
        settingRow('Takma ad', 'Diğer oyuncular seni bu adla görür', el('div', 'set-account-name', [field.root, saveButton.root])),
        kind,
        settingRow('Çıkış yap', a.user?.guest ? 'Misafir hesaba bu tarayıcıdan bir daha girilemez' : undefined, prompt('Çıkış yap', '', 'secondary', () => {
          this.net?.leave();
          void a.signOut();
        }).root),
        settingRow('Hesabımı sil', 'Hesabın, takma adın ve oturumların kalıcı olarak silinir', del.root),
        privacy,
        terms,
      ]),
    );
  }

  private renderOnline(): void {
    const n = this.net;
    if (n && n.status !== 'offline' && n.server) {
      const others = n.players.size;
      this.onlineBox.replaceChildren(
        settingSection('Online', [
          settingRow(
            n.server.name,
            n.status === 'online' ? (others ? `Gökte ${count.format(others)} oyuncu daha var` : 'Şimdilik gökte yalnızsın') : 'Bağlanılıyor…',
            prompt('Sunucudan çık', '', 'secondary', () => n.leave()).root,
          ),
        ]),
      );
    } else {
      this.onlineBox.replaceChildren();
    }
  }

  dispose(): void {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
  }
}

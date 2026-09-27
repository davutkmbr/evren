/**
 * The player's account (phase 26): provides the 'account' service over the Worker's endpoints (worker/auth.ts,
 * worker/account.ts). Plain fetch calls to Better Auth's routes, so the game ships no auth library; the session is a
 * same-site cookie. Checks the session once on start; a single-player game that never goes online sends only that.
 */
import { UpdateOrder, type AccountService, type NicknameResult, type System } from '../core/contracts';
import { exposeDebug } from '../core/dev-tools';

interface MeResponse {
  user?: { id: string; guest: boolean; email?: string };
  profile?: { nickname: string } | null;
  providers?: { google: boolean };
}

async function post(path: string, body: unknown = {}): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createAccountSystem(): System {
  let status: AccountService['status'] = 'unknown';
  let user: AccountService['user'] = null;
  let nickname: string | null = null;
  let googleAvailable = false;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((fn) => fn());

  const service: AccountService = {
    get status() {
      return status;
    },
    get user() {
      return user;
    },
    get nickname() {
      return nickname;
    },
    get googleAvailable() {
      return googleAvailable;
    },
    async refresh() {
      try {
        const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
        const me = (await res.json()) as MeResponse;
        googleAvailable = !!me.providers?.google;
        if (res.ok && me.user) {
          status = 'signed-in';
          user = me.user;
          nickname = me.profile?.nickname ?? null;
        } else {
          status = 'signed-out';
          user = null;
          nickname = null;
        }
      } catch {
        // Offline or no API (a static host): stay as we were; single player does not need it.
      }
      changed();
    },
    async playAsGuest(name) {
      if (status !== 'signed-in') {
        const res = await post('/api/auth/sign-in/anonymous');
        if (!res.ok) {
          return 'error';
        }
        await service.refresh();
      }
      return service.setNickname(name);
    },
    async setNickname(name): Promise<NicknameResult> {
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: name }),
      });
      if (res.ok) {
        nickname = ((await res.json()) as { profile: { nickname: string } }).profile.nickname;
        changed();
        return 'ok';
      }
      return res.status === 400 ? 'invalid' : res.status === 409 ? 'taken' : 'error';
    },
    async signInWithGoogle() {
      const res = await post('/api/auth/sign-in/social', { provider: 'google', callbackURL: location.href });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (res.ok && body?.url) {
        location.assign(body.url);
      }
    },
    async signOut() {
      await post('/api/auth/sign-out');
      await service.refresh();
    },
    async deleteAccount() {
      const res = await fetch('/api/me', { method: 'DELETE', credentials: 'same-origin' });
      await service.refresh();
      return res.ok;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  return {
    name: 'account',
    order: UpdateOrder.UI,
    init(ctx) {
      ctx.services.provide('account', service);
      void service.refresh();
      exposeDebug('__account', service);
    },
  };
}

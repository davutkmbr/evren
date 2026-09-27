/**
 * Profiles (table `profile`, migrations/0001_accounts.sql): the public face of an account, the nickname other players
 * see. Every query on the table lives here.
 */

export interface Profile {
  nickname: string;
}

/** Nicknames are unique regardless of case, with Turkish folding ("Işıl" and "ışıl" are the same name). */
export function nicknameKey(nickname: string): string {
  return nickname.toLocaleLowerCase('tr');
}

export async function getProfile(db: D1Database, userId: string): Promise<Profile | null> {
  return db.prepare('SELECT nickname FROM profile WHERE user_id = ?1').bind(userId).first<Profile>();
}

/** Creates or renames the profile; `taken` when another account holds the nickname. */
export async function setNickname(db: D1Database, userId: string, nickname: string): Promise<'ok' | 'taken'> {
  const now = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO profile (user_id, nickname, nickname_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (user_id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, updated_at = excluded.updated_at`,
      )
      .bind(userId, nickname, nicknameKey(nickname), now)
      .run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return 'taken';
    }
    throw e;
  }
  return 'ok';
}

/** A guest linked to another account: its profile moves there, unless that account already has one. */
export async function moveProfile(db: D1Database, fromUserId: string, toUserId: string): Promise<void> {
  await db
    .prepare('UPDATE profile SET user_id = ?1 WHERE user_id = ?2 AND NOT EXISTS (SELECT 1 FROM profile WHERE user_id = ?1)')
    .bind(toUserId, fromUserId)
    .run();
}

/** Deletes the account; sessions, the Google link and the profile go with it (foreign keys, on delete cascade). */
export async function deleteAccount(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM "user" WHERE id = ?1').bind(userId).run();
}

-- One account row per provider identity (a Google subject, a SteamID64): Steam sign-in (worker/steam) relies on it
-- when two first sign-ins of the same player race. Better Auth's schema does not declare it.
create unique index "account_provider_account_uidx" on "account" ("providerId", "accountId");

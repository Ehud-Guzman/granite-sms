# Backups and restores

There are three layers. Only the first two protect fees, marks and attendance.

| Layer | What it covers | Use it for |
|---|---|---|
| **Neon point-in-time restore** | The whole database, to any moment inside your plan's history window | "Something went wrong an hour ago — undo it" |
| **Nightly off-site dump** (`.github/workflows/backup-db.yml`) | The whole database, once a day, encrypted, kept in Cloudflare R2 | Neon account loss, a mistake noticed after the history window, audits |
| In-app snapshot (Settings → Backups) | Users, teachers, classes, students, subjects, assignments, settings only | Copying a school's set-up. **Not** a backup of fees, marks or attendance. |

The in-app "Replace" restore is switched off (audit finding C2). "Merge" only adds
missing classes, students, subjects and user accounts; it never changes existing
accounts or the school's plan.

## One-time set-up of the nightly dump

1. **Cloudflare R2:** create a bucket, e.g. `granite-sms-backups`.
   - Add a lifecycle rule to delete objects under `daily/` after 35 days.
   - Create an R2 API token with *Object Read & Write* on that bucket only.
2. **Neon:** copy the **direct** (non-pooled) connection string of the production database.
3. **GitHub** → repository → Settings → Secrets and variables → Actions. Add:
   - `PROD_DATABASE_URL`
   - `BACKUP_PASSPHRASE`: a long random string, e.g. `openssl rand -base64 32`. **Store it in your password manager too.** Without it no backup can be read.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
4. Actions → "Back up database" → **Run workflow**. The run summary should say "restored cleanly" and list row counts.

Every run restores its own dump into a scratch database before uploading it,
so a green run means the backup is known to be usable.

## Restoring from a nightly dump

```sh
# 1. Download and decrypt
aws s3 cp s3://granite-sms-backups/daily/granite-<STAMP>.dump.gpg . \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
gpg --decrypt --output granite.dump granite-<STAMP>.dump.gpg

# 2. Restore into a NEW Neon branch or database first, never straight over production.
#    Use pg_restore from the same Postgres major version as that database
#    (e.g. docker run --rm -v "$PWD:/w" postgres:17 pg_restore ...): a newer
#    version writes settings an older server rejects.
pg_restore --no-owner --no-privileges --exit-on-error -d "<NEW_DATABASE_URL>" granite.dump

# 3. Check it, then point the API at it (Render env DATABASE_URL) and redeploy
cd server
DATABASE_URL="<NEW_DATABASE_URL>" npm run db:orphans
DATABASE_URL="<NEW_DATABASE_URL>" npm run fees:reconcile
```

## Restore drill

Once a term, restore last night's dump into a scratch Neon branch (steps above),
sign in to a copy of the app pointed at it, and check one school's fee
statement and one published result against production. Note the date here.

| Date | Dump used | Checked by | Result |
|---|---|---|---|
| | | | |

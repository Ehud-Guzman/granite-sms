# Audit 2: Phase 2 results (security)

**Date:** 14 Nov 2026 · **Commit:** `audit-2-baseline` (`05ddd5e`) · **Plan:** [../AUDIT_PLAN.md](../AUDIT_PLAN.md), section 3

## Verdict

**1 High (fixed, not committed), 6 Medium, 12 Low.** The core holds: tenant isolation, sessions, roles and audit logging all held up (Phase 1 and the role matrix below). The High was M-Pesa callbacks that anyone who can read the logs could forge. It's now fixed in the audit worktree; see A2-SEC-03.

## Fix first (High)

See A2-SEC-03 below.

### A2-SEC-02 · Accounts with plain-text passwords in `seed.js`: VERIFIED, downgraded to **Low** (14 Nov)

**Answered:** every account and address is dummy data, and production will run on fresh databases. The seed also already refuses `NODE_ENV=production` and any non-local host unless `SEED_ALLOW_PROD` or `SEED_ALLOW_REMOTE` is set. So this is cleanup: when you touch the file, move the accounts to env vars (as `SEED_SYSADMIN_*` does) and set `mustChangePassword: true`. Make sure the production setup never sets those two overrides. The original write-up is kept below for the record.

`server/prisma/seed.js` lines ~404–445, on `main` today and in history since commit `c6c3c69` (24 Jan 2026).

- **What it contains:** four accounts with Gmail addresses and their passwords written in the file: a school **ADMIN**, a **BURSAR** and teachers. The passwords are not repeated in this report.
- **Why it matters:**
  - `docker-compose.yml` runs `npm run prisma:seed` every time the API container starts, so any database built that way has these logins with known passwords.
  - The passwords are in git history, so deleting the lines doesn't remove them. Anyone with the repo has them.
  - If any of these are real people's addresses, those people's own passwords may be exposed too, wherever they reused them.

**You need to answer these (I couldn't check them from here):**
1. Is the GitHub repo public or private?
2. Did `seed.js` ever run against a Neon database (dev, demo or production)? If so, those accounts exist there with these passwords.
3. Are the four addresses real people, and are those passwords used anywhere else?

**Fix (S):**
- Remove the four accounts from `seed.js`. Take seed accounts from env vars, as `SEED_SYSADMIN_*` already does, with `mustChangePassword: true`.
- Change or deactivate those accounts in every database that has them.
- If any of them are real people's passwords, tell those people to change them wherever they use them.
- Rewriting git history (`git filter-repo`) is optional once the passwords are changed. If the repo is public, treat the passwords as burned either way.

### A2-SEC-03 · Anyone who can read the logs can forge M-Pesa payments: VERIFIED, **FIXED 14 Nov (not committed)**

**What changed (audit-2 worktree):**
- `src/utils/logRedact.js`: the request log (JSON and text) now writes `/api/public/mpesa/[redacted]/...`.
- `src/routes/mpesa.js` `configFor`: with `NODE_ENV=production` and no `MPESA_ALLOWED_IPS`, every callback is refused with 503 and one clear log line. With an allowlist, other addresses get 403, as before.
- `tests/mpesa.callbacks.test.js` (permanent, runs in CI): the log path is redacted; in production, no allowlist means refused and nothing posted; an address outside the list is refused; an allowed address is accepted.
- `docs/MPESA.md`: `MPESA_ALLOWED_IPS` is now marked required in production, with a note on `trust proxy`.
- Full suite: 187 passed, run twice.

**Still open:**
- **Verifying payments with Safaricom:** confirming each C2B payment with Daraja's Transaction Status API before posting it. That's defense in depth now that the allowlist is enforced. M.
- **Issuing a new callback token** from the UI. S.
- **`trust proxy`:** must match the real proxy chain, or the allowlist will refuse genuine callbacks (see the Phase 2 "Not checked" list).

The original write-up:

[app.js](../../server/src/app.js) request log; [routes/mpesa.js](../../server/src/routes/mpesa.js) `publicRouter`.

1. **The token is logged.** The callback URL carries the school's secret token (`/api/public/mpesa/<token>/c2b/confirmation`), and the production request log writes the full path. I ran the API with `NODE_ENV=production` and the log line held `"path":"/api/public/mpesa/SECRET-CALLBACK-TOKEN-1234/c2b/confirmation"`.
2. **The token is the only check.** A confirmation with the right token is recorded as a payment. Its `TransID` and amount are never checked with Safaricom. `MPESA_ALLOWED_IPS` is documented as optional.

Together: anyone with log access can post a confirmation that marks a learner's fees as paid, and receive a receipt, without any money moving. Log access includes Render team members, any log drain or monitoring service, and anyone sent logs for support.

**Fix (S–M):**
- Redact the path segment after `/api/public/mpesa/` in the request log.
- Make `MPESA_ALLOWED_IPS` required in production: refuse to start without it when M-Pesa is configured.
- Better still, confirm each C2B payment with Daraja's Transaction Status API before posting it, or hold unverified callbacks for the bursar to approve.
- Rotate every school's callback token after the log fix ships.

## Medium

| ID | Finding | Evidence | Fix | Effort |
|---|---|---|---|---|
| A2-SEC-04 | **Parent temporary passwords are kept in the SMS log, which bursars can read.** Creating a parent login with SMS on writes the temporary password into `SmsMessage.body`. `GET /api/sms/messages` (ADMIN, BURSAR) returns it. A bursar can sign in as the parent first, complete the forced password change, and own the parent account. The passwords also stay in the database and in every backup. | VERIFIED: `phase2.findings.test.js` (the bursar's log contains the password; logging in with it works) | Store the SMS body with the password masked (`••••`), and send the real text without saving it. Or send a one-time set-password link instead. Clear the passwords already stored. | S |
| A2-SEC-05 | **A platform owner can impersonate another platform owner.** | VERIFIED: test gets 200 | Refuse when the target is SYSTEM_ADMIN. | S |
| A2-SEC-06 | **Impersonation tokens last the full 12 hours.** | VERIFIED: `exp − iat` = 43,200 s | Issue them for 30–60 minutes, and show a banner on screen while impersonating. | S |
| A2-OPS-01 | **SMS goes out twice when two server instances run.** `flushOutbox` reads queued rows and sends them without claiming them first. One server is safe: the "send now" path and the timer share one guard, which corrects my lead in the plan. Two servers each send every message. That costs money and confuses parents. | VERIFIED: two module instances flushing together sent the same message **twice** | Claim rows atomically before sending (`UPDATE … SET status='SENDING' … RETURNING` or `FOR UPDATE SKIP LOCKED`). Until then, run exactly one instance. | S |
| A2-SEC-07 | **M-Pesa PIN prompts can go to any phone, with no limit.** Both `POST /api/portal/learners/:id/pay` (parent) and `POST /api/mpesa/stk` (bursar) take any `phone` from the request. Only the general 300-a-minute per-user limit applies, so one parent account can flood a stranger's phone with PIN requests, using the school's Daraja quota. | Code: `routes/portal.js`, `routes/mpesa.js` | For parents, allow only their own number on file. For staff, allow numbers of the learner's guardians, or log and limit others. Cap prompts per phone and per requester (for example 3 per 10 minutes). | S |
| A2-SEC-08 | **No security headers on the client, and the session token lives in `localStorage`.** `client/public/` has `_redirects` but no `_headers`, so there's no CSP, `frame-ancestors`, HSTS or `Referrer-Policy`. Any XSS on the client would mean account takeover. I found no XSS sink (no `dangerouslySetInnerHTML` or `innerHTML`), so this is about defense in depth. | Code | Add `client/public/_headers` with a strict CSP (`script-src 'self'`, `connect-src` the API, `frame-ancestors 'none'`), plus HSTS and `Referrer-Policy`. Moving the token to an httpOnly cookie can wait. | S |

## Low

| ID | Finding | Fix |
|---|---|---|
| A2-SEC-09 | Parents, students and teachers can read the school's subscription plan (`GET /api/fees/subscription`). Teachers also get plan usage (`/api/settings/subscription/overview`). | Limit both to ADMIN. |
| A2-SEC-10 | Students get the whole school's exam session list (`GET /api/exams/sessions`). | Limit it to their own class, or to published sessions. |
| A2-SEC-11 | `x-access-token` is accepted as well as `Authorization`. | Remove it. |
| A2-SEC-12 | CORS sends `credentials: true` though no cookies are used. | Remove it, unless you move to cookies. |
| A2-SEC-13 | Password rules are minimal (8 characters, a letter and a digit). They're copied in two files (`auth.js`, `users.js`), and bcrypt cost is 10. | One shared rule. Add a common-password check, and use cost 12. |
| A2-SEC-14 | Bootstrap signup counts users and then creates one, so two calls at once could both succeed. It's only reachable with `ALLOW_BOOTSTRAP=true`. | Confirm it's off on Render, or remove the route. |
| A2-SEC-15 | The Excel import reads the whole workbook before checking the 2,000-row cap. A 3 MB XLSX can expand far larger in memory (zip bomb). | Use the ExcelJS streaming reader, and stop after 2,000 rows. |
| A2-SEC-16 | The full-school export doesn't use the formula-injection guard that the other exports use. It's safe today, because ExcelJS writes strings as text. | Use `sanitizeRow` there too. |
| A2-SEC-17 | M-Pesa credentials are encrypted correctly (AES-256-GCM, random IV, tag checked), but the ciphertext isn't tied to its school and there's no key rotation. `callbackToken` is stored in plain text. | Add `schoolId` as additional authenticated data, a key id in the `v1:` prefix, and store a hash of the callback token. |
| A2-SEC-01 | (From Phase 1) `change-password` checks the body before the session. | Check the session first. |
| A2-CODE-01 | (From Phase 1) The `/api/auth/admin/create-user` stub is still there. | Delete it. |

## What held up (verified)

- **Who can do what.** `role-matrix.md` (generated) lists all 171 routes × 6 roles. I reviewed every row where a parent, student, teacher or bursar is allowed in.
  - The only surprises are A2-SEC-04, 09 and 10.
  - The matrix showed parents reading another learner's statement and results. When tested directly with a learner known not to be the parent's, both gave 403, including with the matrix's query parameters. The matrix had picked "the first learner" without a fixed order, and that turned out to be the parent's own child; next time it will use a known other learner.
- **No mass assignment.** No route passes a request body straight into a database write.
- **No unscoped lookups.** Every lookup by bare `id` follows a check that the record belongs to the caller's school.
- **Secrets in history.** No `.env` file has ever been committed (114 commits), and the only database URLs are placeholders and local Docker ones. A2-SEC-02 is the exception.
- **Audit log.**
  - It covers sign-in, password changes, impersonation (with the real actor in the metadata on every action), user and role changes, every money action including reversal approve and reject, settings, exports, consent and SMS sends. Exams have their own audit table.
  - No API route can edit or delete audit rows. Only the retention job deletes them, which is intended.
- **Uploads.**
  - Logos: 2 MB cap, PNG/JPEG/WebP checked by magic bytes, no SVG.
  - Import: 3 MB and 2,000 rows (see A2-SEC-15).
- **Exports.** CSV and XLSX reports escape `= + - @` at the start of a cell.

## Not checked here (needs you, or the live environment)

- Whether the repo is public, and whether `seed.js` has run on any Neon database (A2-SEC-02).
- Render's env: `ALLOW_IMPERSONATION`, `ALLOW_BOOTSTRAP` and `MPESA_ALLOWED_IPS`.
- `trust proxy = 1`: correct for Render alone, but wrong if Cloudflare sits in front. With two proxies, every user would share one IP, which affects rate limits and the M-Pesa allowlist.
- Semgrep and gitleaks weren't run, because they need downloading. The grep-based checks above cover the main patterns.

## Files added (branch `audit-2`, not committed)

- `server/tests/audit2/phase2.findings.test.js`: one test per verified finding, stating the safe behaviour. They fail until fixed; then remove the `AUDIT2_SWEEP` gate so they run in CI.
- `server/tests/audit2/sweep.test.js`: gained the `role matrix` suite.
- `docs/audit-2/role-matrix.md` (generated) and `phase2-matrix.json`.

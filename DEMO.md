# The portfolio demo

A copy of Granite SMS that anyone can click through and nobody can change, for linking from the portfolio.
It runs the **same code** with `DEMO_MODE=true`, pointed at **its own database** filled with an invented school,
Mwangaza Academy.

| Part | Where it runs |
| --- | --- |
| Database | Neon (free, does not expire), database named `granite_demo` |
| API | Render web service `granite-sms-demo-api` (separate from the real `granite-sms`) |
| Website | Cloudflare Worker `granite-sms`, built from `client/wrangler.demo.jsonc` |
| Fresh data | GitHub Action "Refresh demo", every night at 00:10 UTC |

## What demo mode does

All of it lives in `server/src/config/demo.js`, `server/src/middleware/demoGuard.js`, the `/api/auth/demo-login`
route in `server/src/routes/auth.js`, and `server/prisma/seedDemo.js`.

- **Every save is refused** with HTTP 403 and the message "This is a read-only demo…". The rule is on the HTTP method,
  not a list of routes, so a route added later is covered too. Only signing in and a platform owner choosing a school get
  through.
- **One-click sign-in** for every role: School Admin, Teacher, Bursar, Student, Platform Owner. `POST /api/auth/demo-login`
  answers 404 anywhere `DEMO_MODE` is off, and only ever looks up the fixed demo emails, so it cannot sign anyone into a real
  deployment. The demo accounts have one long random password that nobody knows.
- **Refuses to start against the wrong database.** With `DEMO_MODE=true` the API exits unless the database name in
  `DATABASE_URL` contains `demo`. The seed has the same check, because `--reset` empties the database.
- **Invented data only.** Every email ends in `.invalid` (a reserved domain that cannot receive mail), there are no phone
  numbers, and the schools and people are made up.
- The website shows a "Live demo · sample data · read-only" strip with "Try another role" and "Back to portfolio", the
  sign-in page shows one button per role instead of a password form, and the page asks search engines not to index it.

What a visitor can explore as each role:

| Role | Signs in as | Sees |
| --- | --- | --- |
| School Admin | `admin@mwangaza.invalid` | Everything in the school: students, classes, teachers, attendance, exams, results, fees, reports, settings |
| Teacher | Grace Wanjiru | Her classes (class teacher of Grade 7 East; Maths in 7E, 7W, 8E; Science in 7E), registers, marks entry |
| Bursar | Rose Nduta | Invoices, payments, receipts, statements, fee reports |
| Student | Zawadi Kiptoo, Grade 7 East | Her published results and fee statement (65% paid this term) |
| Platform Owner | `platform@granite-demo.invalid` | Three schools on different plans, users, audit log, a backup |

## 1. Database (Neon, free)

1. In Neon, open your project (or create one) and go to **Databases → New database**. Name it **`granite_demo`**.
   The name must contain `demo`.
2. Go to **Connection details**, choose the `granite_demo` database, and **turn connection pooling off** (Prisma's
   migrations need a direct connection). Copy the string. It looks like
   `postgresql://<user>:<password>@ep-xxxx.<region>.aws.neon.tech/granite_demo?sslmode=require`

## 2. Put the sample school in (from your PC, once)

```powershell
cd server
$env:DATABASE_URL = "<the granite_demo string from step 1>"
npx prisma migrate deploy
node prisma/seedDemo.js                              # dry run: names the database, writes nothing
node prisma/seedDemo.js --confirm-write --reset      # builds the school (about a minute over the internet)
```

(Call `node` directly in PowerShell: `npm run seed:demo -- --confirm-write` does not work there, because PowerShell
swallows the `--` and the flags never arrive, so it only does the dry run. If Neon was asleep and the first try says
"Can't reach database server", add `&connect_timeout=30` to the end of the string and run it again.)

After this the GitHub Action keeps it fresh (step 5).

## 3. The API (Render, free)

New → **Web Service** → this repository.

| Setting | Value |
| --- | --- |
| Name | `granite-sms-demo-api` |
| Region | Same as the Neon database if possible (e.g. Oregon / US West if Neon is `us-west-2`) |
| Root Directory | `server` |
| Build Command | `npm install && npx prisma generate && npx prisma migrate deploy` |
| Start Command | `npm start` |
| Instance Type | Free |

Environment variables:

| Name | Value |
| --- | --- |
| `DEMO_MODE` | `true` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the `granite_demo` string from step 1 |
| `JWT_SECRET` | a **new** random string of 48+ characters, never the real system's |
| `ALLOWED_ORIGINS` | the demo website's address from step 4, e.g. `https://granite-sms-demo.<account>.workers.dev` |

Check it: `https://granite-sms-demo-api.onrender.com/health` answers `{"status":"ok"}`, and the logs say
`DEMO MODE: read-only, one-click demo sign-in enabled.`

**Cold starts.** Render's free tier sleeps after about 15 minutes idle; the first visitor then waits up to a minute (the
sign-in buttons say so while they wait).

## 4. The website (Cloudflare)

1. Cloudflare → Workers & Pages → Create → **Import a repository** → this repository. Name it `granite-sms` (it must
   match `name` in `client/wrangler.demo.jsonc`).
2. Root directory `client`. Build command `npm run build`. Deploy command
   `npx wrangler deploy --config wrangler.demo.jsonc`.
3. Build variables: `NODE_VERSION=22`, `VITE_DEMO_MODE=true`, `VITE_API_URL=https://granite-sms-demo-api.onrender.com`,
   `VITE_PORTFOLIO_URL=https://glimmerink.co.ke`.
4. Put the Worker's address into the demo API's `ALLOWED_ORIGINS` on Render, and redeploy the API.

Every push to `main` now rebuilds the demo site.

## 5. Keep it fresh (GitHub Action)

GitHub → this repository → Settings → Secrets and variables → Actions → **New repository secret**:
name `DEMO_DATABASE_URL`, value the `granite_demo` string. Then Actions → **Refresh demo** → Run workflow once to check
it. From then on it rebuilds the school every night at 00:10 UTC (03:10 in Nairobi). Anyone signed into the demo at that
moment is signed out and simply picks a role again.

## 6. Smoke test after deploying

- The sign-in page shows five "Explore as …" buttons; each opens a dashboard with data.
- School Admin: Fees shows today's collections; Attendance has today's registers (two still in draft); Results for
  Grade 7 East has a ranked class list.
- Try to save anything (add a student, record a payment): a "read-only demo" message appears and nothing changes.
- `POST /api/auth/demo-login` on the **real** API (`granite-sms`) answers 404.

## Safety summary

The demo can never affect real users because:
1. It is a separate Render service with its own database; it shares only code.
2. Demo mode will not start unless the database name contains `demo`.
3. The demo seed will not write unless the database name contains `demo`.
4. Demo sign-in is switched off (404) wherever `DEMO_MODE` is not `true`, and only knows the `.invalid` demo emails.

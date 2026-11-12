# SMS to parents

The API sends SMS through Africa's Talking. Until it's configured, every
message is still recorded in the outbox (Settings → SMS → Sent messages) with
status **SKIPPED**, so nothing is lost and you can check the wording first.

## What gets sent

| Message | When | Switch |
|---|---|---|
| Payment receipt (amount, receipt no., balance or credit) | A payment is recorded | Payment receipts |
| Absence alert | A register is submitted, for each learner marked absent | Absence alerts (off by default) |
| Results are out (average, grade, position) | Exam results are published | Results are out |
| Fee balance reminder (+ your "how to pay" line) | Admin or bursar sends reminders | — |
| A message to parents of chosen classes | Admin sends it | — |

Messages go to each learner's **primary** parent who has "receives SMS" on
(the Parents & guardians card on the learner's profile). Broadcasts go once to
every parent phone in the chosen classes. Each school turns SMS on in
Settings → SMS; it is off by default.

## Setting up Africa's Talking

1. Create an account at africastalking.com and an app. Request a **sender ID**
   (e.g. `MWANGAZA`): approval by the networks takes a few days. Without one,
   messages come from a shared short code.
2. Top up the account (SMS are prepaid).
3. Set these on the API (Render → Environment):

   | Variable | Value |
   |---|---|
   | `SMS_PROVIDER` | `africastalking` |
   | `AT_USERNAME` | your app username (`sandbox` for testing) |
   | `AT_API_KEY` | the app's API key |
   | `AT_SENDER_ID` | your approved sender ID (optional) |
   | `AT_SANDBOX` | `true` while testing with the sandbox app |

4. Redeploy. Settings → SMS stops showing "No SMS provider is set up".

Failed messages are retried every minute, up to 3 attempts; the reason is
shown on the message in the outbox.

Parents' phone numbers and the message text are personal data: only send what
the school would be comfortable seeing forwarded.

# M-Pesa

Each school connects its own paybill (or till). Parents pay with the
**learner's admission number as the account number**; the payment is then
recorded on that learner's fee account automatically (oldest unpaid invoice
first, anything extra as credit) and the parent gets the receipt SMS if SMS is
on. Payments whose account number doesn't match a learner wait under
Fees → M-Pesa → "Needs a learner" for the bursar to assign.

The bursar can also send a payment prompt ("enter your M-Pesa PIN") to the
primary parent's phone from Receive Payment → "Send M-Pesa prompt".

## Server set-up (once)

| Variable | Value |
|---|---|
| `MPESA_ENC_KEY` | `openssl rand -base64 32`: encrypts schools' Daraja credentials. **Keep a copy**: without it saved credentials can't be read. |
| `PUBLIC_API_URL` | The API's public https address, e.g. `https://granite-sms.onrender.com`. Safaricom calls back here. |
| `MPESA_ALLOWED_IPS` | Optional: comma-separated Safaricom callback IPs, to refuse callbacks from anywhere else. |

## Per school (Fees → M-Pesa → Paybill set-up)

1. On developer.safaricom.co.ke create an app with **M-Pesa Express** (for
   prompts) and **C2B**. For a live paybill, go through Safaricom's Go Live
   process for that shortcode.
2. Enter the paybill/till number, the app's consumer key and secret, and the
   passkey (needed only for payment prompts). Choose Sandbox to test.
3. Click **Connect paybill to Granite**. This registers the payment
   notification addresses with Safaricom.
4. Test: pay a small amount to the paybill with a learner's admission number
   as the account. It should appear under Recent M-Pesa payments as MATCHED
   and on the learner's statement.

## How it behaves

- Safaricom sometimes sends the same payment twice: the M-Pesa receipt number
  is unique, so repeats are ignored.
- Admission numbers are matched ignoring case, spaces, dashes, dots and
  slashes ("adm 0042" = "ADM-0042"). Two learners matching the same text
  counts as no match.
- Each school's callback addresses contain a long random token; Safaricom is
  always answered "accepted" so it doesn't retry endlessly, and anything that
  couldn't be matched is kept for the bursar.

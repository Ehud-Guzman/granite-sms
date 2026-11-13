# Privacy and the Data Protection Act, 2019

Granite SMS stores data about children, which the Act treats with extra care (s.33). This page covers what the system gives a school to meet that. It isn't legal advice: each school registers with the ODPC as the data controller, and GlimmerInk, as the host, is the data processor.

## Consent

On a learner's profile, **Privacy** records:

- who gave consent, usually a parent, and on what date;
- whether photos and publication are allowed, which is a separate yes or no.

Consent can be withdrawn there too. Every change goes into the audit log. Learners with no consent are marked **No consent recorded**.

## A parent asks for their child's data

On the learner's profile, **Export data** downloads everything held about them: the profile, guardians, fees, results and attendance. **Settings > Data export** downloads the whole school.

## Removing a former learner's details

When a learner has left (their exit is recorded), an admin can remove their personal details from the profile. They type the admission number to confirm. This can't be undone.

**Removed:**

- name, date of birth and gender;
- their login;
- report card comments;
- SMS sent about them;
- M-Pesa payer names and phone numbers;
- the details in older audit entries.

The admission number becomes `ANON-…`.

Parents are unlinked. A parent with no other child at the school is deleted, along with their portal login.

**Kept, without the name:** invoices, payments, marks, attendance and published results, so the school's books and class statistics still add up.

## Retention

`npm run privacy:retention` (in `server/`) applies these default rules:

| Data | Kept for |
|---|---|
| Audit log | 7 years |
| Attendance edit history | 7 years |
| SMS that were sent, failed or skipped | 2 years |
| Learners who left | 7 years after leaving, then anonymised |

The script only reports by default. To apply the rules:

```bash
npm run privacy:retention                                   # report only
npm run privacy:retention -- --write                        # delete old logs and messages
npm run privacy:retention -- --write --anonymise-leavers    # also anonymise old leavers
```

To change the periods, set `RETENTION_AUDIT_YEARS`, `RETENTION_ATTENDANCE_EDIT_YEARS`, `RETENTION_SMS_YEARS` or `RETENTION_LEAVER_YEARS`.

Run the script once a term, for example as a Render cron job. Check the school's own policy first: KRA expects financial records to be kept for at least 5 years, and fee records are never deleted by this script.

## Still for the school to do

- Register with the ODPC.
- Sign a data-processing agreement with GlimmerInk.
- Write a privacy notice for parents.
- Have a breach plan: the ODPC must be told within 72 hours (s.43).

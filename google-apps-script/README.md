# Fresh Google Workspace setup

This setup deliberately does not reuse the former personal Google account,
spreadsheet, Apps Script project, or secret. Create the complete automation
while signed in as `secretariat@pbast10.org`.

## 1. Create the tracker from the Workspace account

1. Sign out of personal Google accounts or open a private browser window.
2. Sign in only as `secretariat@pbast10.org`.
3. Open [script.google.com](https://script.google.com) and select
   **New project**.
4. Rename the project `PBAST10 Abstract Automation`.
5. Replace the contents of `Code.gs` with the repository's
   `google-apps-script/Code.gs`.
6. Add a script file named `AdminSync.gs` and copy the repository's
   `google-apps-script/AdminSync.gs` into it.
7. Open **Project Settings**, enable **Show "appsscript.json" manifest file in
   editor**, and replace the manifest with
   `google-apps-script/appsscript.json`.
8. Save all three files.
9. Select `initializePBAST10` in the function menu and click **Run**.
10. Approve the requested Google Sheets, email, and external-request
    permissions.

`initializePBAST10()` automatically:

- creates `PBAST10 Abstract Submission Tracker` in the Workspace account;
- creates and formats `Summary`, `Abstract Tracker`, and `Revision History`;
- creates a hidden `Lists` tab and applies the committee workflow dropdowns,
  filters, date formats, column widths, and status colors used by the prior
  tracker template;
- adds live counts for total, new, accepted, oral, poster, rejected, and
  notifications sent;
- generates a random `SYNC_SECRET` only when the property does not already
  exist;
- sets the official reply address to `secretariat@pbast10.org`;
- sets the site URL and revision deadline defaults.
- sets Brevo as the transactional email provider and initializes the verified
  sender address/name; the API key must still be added manually.

It is safe to run the initializer again. It reuses the configured spreadsheet
and secret and does not delete submissions. Re-running it also creates or
refreshes the tracker formatting, dropdowns, hidden `Lists` tab, and `Summary`
tab without rebuilding the tracker. Netlify's `SHEETS_SYNC_SECRET` does not
need to be changed after a normal rerun. A new secret is generated only after
deleting `SYNC_SECRET` from Script Properties or using a different Apps Script
project.

Open **Execution log** after the run and save these two outputs temporarily:

- the new spreadsheet URL;
- `SHEETS_SYNC_SECRET`.

Do not paste the secret into email, GitHub, documentation, or the spreadsheet.
The canonical copy remains under **Project Settings -> Script Properties**.

## 2. Check the generated configuration

Under **Project Settings -> Script Properties**, confirm:

| Property | Expected value |
|---|---|
| `SPREADSHEET_ID` | Automatically generated ID |
| `SYNC_SECRET` | Automatically generated random value |
| `SITE_URL` | `https://pbast10.org` |
| `REPLY_TO_EMAIL` | `secretariat@pbast10.org` |
| `REVISION_DEADLINE` | `2026-11-30T23:59:59+09:00` |
| `EMAIL_PROVIDER` | `brevo` |
| `BREVO_API_KEY` | Brevo transactional API key; never commit this value |
| `BREVO_SENDER_EMAIL` | A sender authenticated in Brevo, normally `secretariat@pbast10.org` |
| `BREVO_SENDER_NAME` | `PBAST10 Organizing Committee` |
| `REVIEWER_PORTAL_URL` | `https://pbast10-admin.drygchung.chatgpt.site/reviewer/login` |
| `BREVO_TEST_RECIPIENT` | Address that receives the direct Brevo test |
| `TEST_EMAIL_RECIPIENT` | Legacy alias accepted when `BREVO_TEST_RECIPIENT` is absent |

Change `REVISION_DEADLINE` before deployment if the actual revision schedule is
different. Use an ISO 8601 timestamp with the Seoul offset.

`EMAIL_PROVIDER=brevo` is the production setting and the code defaults to
Brevo if the property is absent. A missing Brevo key therefore produces an
explicit configuration error instead of silently sending from Google
MailApp. If Brevo is temporarily unavailable, change `EMAIL_PROVIDER` to
`mailapp` explicitly; the same templates are then sent through the Google
Workspace account that owns the deployment. Do not store the Brevo API key in
GitHub, the spreadsheet, Netlify form fields, or client-side JavaScript.

### Send a real test email

1. Set `BREVO_TEST_RECIPIENT` under **Project Settings -> Script Properties**.
2. Select `testBrevoTransactionalDelivery` in the Apps Script function menu.
   `sendTestEmail` is an equivalent alias and is also shown.
3. Click **Run** and approve permissions if Google prompts.
4. Open **Execution log**. A successful run returns `ok: true`, the provider,
   recipient, Brevo message ID, and timestamp.
5. Confirm both receipt in the destination mailbox and a successful event in
   **Brevo -> Transactional -> Logs**.

This sends a real email directly through the same `sendViaBrevo_()` helper used
by abstract confirmations, acceptance notifications, and reviewer invitations.
It does not create a test abstract or change the spreadsheet. A successful
HTTP 201 response proves that Brevo accepted the request; inbox delivery must
still be checked separately.

## 3. Deploy the new web app

1. Select **Deploy -> New deployment**.
2. Choose **Web app**.
3. Set **Execute as** to `secretariat@pbast10.org`.
4. Set **Who has access** to **Anyone** so the Netlify function can call it.
5. Deploy and copy the URL ending in `/exec`.

The endpoint is public, but every request must contain the matching secret.
Requests without it are rejected before taking the spreadsheet write lock.

If Google displays **Google hasn't verified this app**, use
**Advanced -> Go to PBAST10 Abstract Automation -> Allow**. This is an
owner-operated Workspace script, not a public OAuth application.

After later code changes, saving alone does not update the live endpoint. Use
**Deploy -> Manage deployments -> Edit -> New version -> Deploy**. The `/exec`
URL then remains unchanged.

Submission confirmations, revision confirmations, withdrawal confirmations,
acceptance notifications, email-change alerts, and reviewer invitations are
sent only by this Apps Script deployment. Changes to their subjects, plain-text
bodies, HTML bodies, or provider logic therefore require a new Apps Script
deployment version, but do not require a Netlify redeploy or DNS change.

## 4. Connect Netlify

In **Netlify -> Project configuration -> Environment variables**, set:

| Variable | Value |
|---|---|
| `GOOGLE_SHEETS_WEBHOOK_URL` | New Apps Script `/exec` URL |
| `SHEETS_SYNC_SECRET` | Secret generated by `initializePBAST10()` |

Remove any values pointing to the former personal Google project. Trigger a new
Netlify production deploy after changing the variables.

In **Notifications -> Form submission notifications**, set the recipient to
`secretariat@pbast10.org`.

## 5. End-to-end verification

Use a disposable test submission and verify all of the following:

1. The submission appears in Netlify Forms.
2. Exactly one row appears in `Abstract Tracker`.
3. The submitter receives the confirmation email.
4. The Brevo transactional log records a successful delivery request and the
   message header shows the authenticated PBAST10 sender with
   `secretariat@pbast10.org` as Reply-To.
5. The subject begins with `[PBAST10]`, contains the non-secret submission ID,
   and the message includes both a plain-text body and a minimal HTML body with
   exactly one direct revision link.
6. The private revision link loads the submitted data.
7. A revised PDF updates the tracker and appends one row to `Revision History`.
8. The old revision token no longer works.
9. Replaying the same controlled event does not create a duplicate row.
10. Delivery succeeds to Gmail, Outlook, and an institutional mailbox.

The official transactional path is:

```text
Netlify form
-> Netlify function
-> Workspace Apps Script
-> Workspace spreadsheet
-> Brevo transactional email API
```

The Apps Script falls back to Google MailApp only when
`EMAIL_PROVIDER=mailapp`. The provider choice applies consistently to
submission, revision, withdrawal, acceptance, and reviewer-access messages.

Names are stored as **Family name, Given name**. Revision tokens are stored only
as SHA-256 hashes, and each successful revision invalidates the prior token.
Netlify remains the source backup; archive its CSV and uploaded files before
deleting any form or submission.

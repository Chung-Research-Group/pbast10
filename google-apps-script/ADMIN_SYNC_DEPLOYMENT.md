# PBAST10 administrator dashboard synchronization

This change connects the owner-only PBAST10 Conference Control dashboard to
the existing `PBAST10 Abstract Submission Tracker`.

## Updating the Apps Script deployment

The repository copies of `Code.gs`, `AdminSync.gs`, and `appsscript.json` are
the canonical production source. They include the complete Brevo transactional
email helper and every administrator action. Do not preserve an untracked
Brevo-only variant in the Apps Script editor.

1. Open the Apps Script project bound to `PBAST10 Abstract Submission Tracker`.
2. Replace `Code.gs` with `google-apps-script/Code.gs`.
3. Replace or add `AdminSync.gs` with
   `google-apps-script/AdminSync.gs`.
4. Enable the manifest in **Project Settings** and replace
   `appsscript.json` with `google-apps-script/appsscript.json`.
5. Confirm that the existing Script Properties are still present:
   `SPREADSHEET_ID`, `SYNC_SECRET`, `SITE_URL`, `REPLY_TO_EMAIL`,
   `REVISION_DEADLINE`, `EMAIL_PROVIDER`, `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `REVIEWER_PORTAL_URL`.
   Set `BREVO_TEST_RECIPIENT` for diagnostic messages.
   `TEST_EMAIL_RECIPIENT` remains a supported legacy alias.
   Production must use `EMAIL_PROVIDER=brevo`; a missing API key is treated as
   a hard configuration error and does not silently fall back to MailApp.
6. Run `authorizePBAST10()` once and approve any newly requested permissions.
7. Run `testBrevoTransactionalDelivery()` (or its `sendTestEmail()` alias) and
   confirm both the execution-log message ID and the corresponding event in
   Brevo's transactional log.
8. Select **Deploy → Manage deployments → Edit** for the existing web app.
9. Choose **New version**, keep **Execute as: Me** and the existing access
   setting, then deploy.
10. Keep the existing `/exec` URL. Do not change Netlify environment variables
   when that URL and `SYNC_SECRET` are unchanged.

Do not run `initializePBAST10()` for an ordinary code update.

## Security properties

- The dashboard relay uses a separate 256-bit administrator token.
- Only the legacy token's SHA-256 digest is committed to this public
  repository. During a zero-downtime rotation, Netlify may also hold a second
  digest in `PBAST10_ADMIN_TOKEN_SHA256`.
- Plaintext tokens are held only by the owner-only dashboard runtimes. Never
  store a plaintext administrator token in Netlify or GitHub.
- Remove `PBAST10_ADMIN_TOKEN_SHA256` after the new dashboard has been retired
  or its token has been promoted through a reviewed code change.
- The relay reuses Netlify's existing `GOOGLE_SHEETS_WEBHOOK_URL` and
  `SHEETS_SYNC_SECRET`; neither value is returned to the browser.
- `admin-list` excludes consent and edit-token hashes.
- `admin-update` can change only tracker columns O–W.
- A full-row fingerprint prevents stale dashboard updates from overwriting a
  newer manual change in Google Sheets.

# PBAST10 administrator dashboard synchronization

This change connects the owner-only PBAST10 Conference Control dashboard to
the existing `PBAST10 Abstract Submission Tracker`.

## One-time Apps Script deployment

The production Apps Script contains Brevo-specific email helpers that are not
fully represented by the repository copy. Preserve those helpers and make only
the following additive change in the live Apps Script project.

1. Open the Apps Script project bound to `PBAST10 Abstract Submission Tracker`.
2. Add a script file named `AdminSync.gs`.
3. Copy the repository file `google-apps-script/AdminSync.gs` into that file.
4. In `Code.gs`, immediately after:

   ```javascript
   var action = clean_(payload.action) || 'create';
   ```

   add:

   ```javascript
   if (action === 'admin-list') return adminList_(sheet);
   if (action === 'admin-update') return adminUpdate_(sheet, payload);
   ```

5. Save the project.
6. Select **Deploy → Manage deployments → Edit** for the existing web app.
7. Choose **New version**, keep **Execute as: Me** and the existing access
   setting, then deploy.
8. Keep the existing `/exec` URL, `SPREADSHEET_ID`, `SYNC_SECRET`, Brevo
   properties, and all other Script Properties unchanged.

Do not run `initializePBAST10()` and do not replace the production `Code.gs`
with the repository copy.

## Security properties

- The dashboard relay uses a separate 256-bit administrator token.
- Only the token's SHA-256 digest is committed to this public repository.
- The plaintext token is held only by the owner-only dashboard runtime.
- The relay reuses Netlify's existing `GOOGLE_SHEETS_WEBHOOK_URL` and
  `SHEETS_SYNC_SECRET`; neither value is returned to the browser.
- `admin-list` excludes consent and edit-token hashes.
- `admin-update` can change only tracker columns O–W.
- A full-row fingerprint prevents stale dashboard updates from overwriting a
  newer manual change in Google Sheets.

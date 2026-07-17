# Google Sheets sync setup

Target spreadsheet ID:

`1L5musQqOwy2aOO6AAQPmoI3tz7RMTGkro9wAPPqJdvg`

## 1. Create the Apps Script receiver

1. Open the PBAST10 Abstract Submission Tracker in Google Sheets.
2. Select **Extensions -> Apps Script**.
3. Replace the editor contents with `Code.gs` from this folder.
4. Open **Project Settings -> Script Properties** and add:
   - `SPREADSHEET_ID`: `1L5musQqOwy2aOO6AAQPmoI3tz7RMTGkro9wAPPqJdvg`
   - `SYNC_SECRET`: a new long random value used only for this integration
5. Select **Deploy -> New deployment -> Web app**.
6. Set **Execute as** to yourself and **Who has access** to anyone.
7. Authorize the script and copy the `/exec` web app URL.

On the first authorization, Google may display **Google hasn't verified this app**.
Because this is a private script created and run by the spreadsheet owner, select
**Advanced -> Go to the project (unsafe) -> Allow**. Public OAuth verification is
not required for this owner-operated integration.

The endpoint is public because Netlify must reach it, but requests without the matching secret are rejected.

## 2. Configure Netlify

In **Project configuration -> Environment variables**, add:

- `GOOGLE_SHEETS_WEBHOOK_URL`: the Apps Script `/exec` URL
- `SHEETS_SYNC_SECRET`: exactly the same random value used in Apps Script

Do not commit either value to GitHub. Deploy the site again after saving the variables.

## 3. Verify

1. Submit a small test PDF through the production abstract form.
2. Confirm the submission appears in Netlify Forms.
3. Confirm a new row appears in the Google Sheet's `Abstract Tracker` tab.
4. Confirm the abstract file URL opens for an authorized committee member.
5. Submit the same event payload twice only during a controlled test; the submission ID should prevent a duplicate row.

Names are stored and displayed as **Family name, Given name**. The form therefore
asks for family name first, and the `Full Name` column is generated in that format.

Netlify remains the source backup. Export its CSV and archive uploaded files before deleting any form or submission.

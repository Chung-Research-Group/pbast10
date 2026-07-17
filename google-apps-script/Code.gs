/**
 * PBAST10 Netlify Forms -> Google Sheets receiver.
 * Deploy this as a Google Apps Script web app after setting the script properties
 * SPREADSHEET_ID and SYNC_SECRET.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    var properties = PropertiesService.getScriptProperties();
    var expectedSecret = properties.getProperty('SYNC_SECRET');
    var spreadsheetId = properties.getProperty('SPREADSHEET_ID');

    if (!expectedSecret || !spreadsheetId) {
      return jsonResponse_({ ok: false, error: 'Apps Script properties are incomplete.' });
    }

    var payload = JSON.parse(e.postData.contents || '{}');
    if (!payload.secret || payload.secret !== expectedSecret) {
      return jsonResponse_({ ok: false, error: 'Unauthorized.' });
    }

    var data = payload.data || {};
    var submissionId = clean_(payload.submissionId) || Utilities.getUuid();
    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName('Abstract Tracker');

    if (!sheet) {
      return jsonResponse_({ ok: false, error: 'Abstract Tracker sheet was not found.' });
    }

    // Netlify may retry event delivery. Do not add the same submission twice.
    if (sheet.getLastRow() > 1) {
      var existing = sheet
        .getRange(2, 1, sheet.getLastRow() - 1, 1)
        .createTextFinder(submissionId)
        .matchEntireCell(true)
        .findNext();
      if (existing) return jsonResponse_({ ok: true, duplicate: true, submissionId: submissionId });
    }

    var firstName = clean_(data['first-name']);
    var lastName = clean_(data['last-name']);
    var row = [
      submissionId,
      payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
      lastName,
      firstName,
      formatName_(lastName, firstName),
      clean_(data.email),
      clean_(data.affiliation),
      clean_(data.country),
      clean_(data['presentation-preference']),
      clean_(data['primary-topic']),
      clean_(data['abstract-title']),
      clean_(data['co-authors']),
      clean_(data['abstract-file']),
      clean_(data.consent),
      'New',
      '', '', '', '',
      'Pending',
      'Pending',
      'Not Sent',
      '',
    ];

    sheet.appendRow(row);
    return jsonResponse_({ ok: true, duplicate: false, submissionId: submissionId });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

function formatName_(lastName, firstName) {
  if (lastName && firstName) return lastName + ', ' + firstName;
  return lastName || firstName || '';
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

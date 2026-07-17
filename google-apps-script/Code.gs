/**
 * PBAST10 Netlify Forms -> Google Sheets receiver.
 *
 * Required script properties:
 *   SPREADSHEET_ID, SYNC_SECRET
 *
 * Optional script properties:
 *   SITE_URL, REPLY_TO_EMAIL, REVISION_DEADLINE
 */
var TRACKER_SHEET = 'Abstract Tracker';
var HISTORY_SHEET = 'Revision History';
var SITE_URL_DEFAULT = 'https://pbast10.org';
var REPLY_TO_DEFAULT = 'drygchung@pusan.ac.kr';
var REVISION_DEADLINE_DEFAULT = '2026-11-30T23:59:59+09:00';

var COL = {
  SUBMISSION_ID: 1,
  SUBMITTED_AT: 2,
  LAST_NAME: 3,
  FIRST_NAME: 4,
  FULL_NAME: 5,
  EMAIL: 6,
  AFFILIATION: 7,
  COUNTRY: 8,
  PRESENTATION: 9,
  TOPIC: 10,
  TITLE: 11,
  COAUTHORS: 12,
  FILE_URL: 13,
  CONSENT: 14,
  INTAKE_STATUS: 15,
  NOTES: 23,
  TOKEN_HASH: 24,
  REVISION_COUNT: 25,
  LAST_REVISED_AT: 26,
  LAST_REVISION_EVENT_ID: 27,
  CONFIRMATION_STATUS: 28,
  CONFIRMATION_SENT_AT: 29
};

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
    if (!payload.secret || !secureEquals_(String(payload.secret), String(expectedSecret))) {
      return jsonResponse_({ ok: false, error: 'Unauthorized.' });
    }

    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(TRACKER_SHEET);
    if (!sheet) {
      return jsonResponse_({ ok: false, error: 'Abstract Tracker sheet was not found.' });
    }

    ensureTrackerHeaders_(sheet);
    var action = clean_(payload.action) || 'create';

    if (action === 'get') return getSubmission_(sheet, payload, properties);
    if (action === 'revise') return reviseSubmission_(spreadsheet, sheet, payload, properties);
    if (action === 'create') return createSubmission_(spreadsheet, sheet, payload, properties);

    return jsonResponse_({ ok: false, error: 'Unsupported action.' });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function createSubmission_(spreadsheet, sheet, payload, properties) {
  var data = payload.data || {};
  var submissionId = clean_(payload.submissionId) || Utilities.getUuid();
  var existingRow = findRowByValue_(sheet, COL.SUBMISSION_ID, submissionId);

  // Netlify may retry an event. Re-send only when the first email failed.
  if (existingRow) {
    var status = clean_(sheet.getRange(existingRow, COL.CONFIRMATION_STATUS).getValue());
    if (status === 'Confirmation failed' || status === 'Not sent') {
      issueTokenAndSend_(sheet, existingRow, properties, false);
      return jsonResponse_({ ok: true, duplicate: true, resent: true, submissionId: submissionId });
    }
    return jsonResponse_({ ok: true, duplicate: true, submissionId: submissionId });
  }

  validateSubmissionData_(data);
  var firstName = clean_(data['first-name']);
  var lastName = clean_(data['last-name']);
  var token = createToken_();
  var submittedAt = payload.submittedAt ? new Date(payload.submittedAt) : new Date();
  var row = [
    submissionId,
    submittedAt,
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
    'Not sent',
    '',
    hashToken_(token),
    0,
    '',
    '',
    'Not sent',
    ''
  ];

  sheet.appendRow(row);
  var newRow = sheet.getLastRow();
  appendHistory_(spreadsheet, row, submissionId, 0, submittedAt, 'Initial submission');

  try {
    sendConfirmationEmail_(row, token, properties, false);
    sheet.getRange(newRow, COL.CONFIRMATION_STATUS).setValue('Confirmation sent');
    sheet.getRange(newRow, COL.CONFIRMATION_SENT_AT).setValue(new Date());
  } catch (error) {
    sheet.getRange(newRow, COL.CONFIRMATION_STATUS).setValue('Confirmation failed');
    sheet.getRange(newRow, COL.NOTES).setValue('Confirmation email error: ' + String(error.message || error));
    throw error;
  }

  return jsonResponse_({ ok: true, duplicate: false, submissionId: submissionId });
}

function getSubmission_(sheet, payload, properties) {
  if (isRevisionClosed_(properties)) {
    return jsonResponse_({ ok: false, code: 'REVISION_CLOSED', error: 'The abstract revision period has closed.' });
  }

  var token = clean_(payload.token);
  if (!token) return jsonResponse_({ ok: false, code: 'INVALID_LINK', error: 'This revision link is invalid or has expired.' });

  var rowNumber = findRowByValue_(sheet, COL.TOKEN_HASH, hashToken_(token));
  if (!rowNumber) return jsonResponse_({ ok: false, code: 'INVALID_LINK', error: 'This revision link is invalid or has expired.' });

  var row = sheet.getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT).getValues()[0];
  return jsonResponse_({
    ok: true,
    submission: editableDataFromRow_(row),
    revisionCount: Number(row[COL.REVISION_COUNT - 1] || 0),
    deadline: revisionDeadline_(properties).toISOString()
  });
}

function reviseSubmission_(spreadsheet, sheet, payload, properties) {
  if (isRevisionClosed_(properties)) {
    return jsonResponse_({ ok: false, code: 'REVISION_CLOSED', error: 'The abstract revision period has closed.' });
  }

  var data = payload.data || {};
  var eventId = clean_(payload.eventId);
  if (!eventId) throw new Error('Revision event ID is missing.');

  // A verified Netlify event can be delivered again. Avoid applying a revision twice.
  var duplicateRow = findRowByValue_(sheet, COL.LAST_REVISION_EVENT_ID, eventId);
  if (duplicateRow) {
    var duplicateStatus = clean_(sheet.getRange(duplicateRow, COL.CONFIRMATION_STATUS).getValue());
    if (duplicateStatus !== 'Revision confirmation sent') {
      issueTokenAndSend_(sheet, duplicateRow, properties, true);
      return jsonResponse_({ ok: true, duplicate: true, resent: true });
    }
    return jsonResponse_({ ok: true, duplicate: true });
  }

  var token = clean_(data['edit-token'] || payload.token);
  if (!token) throw new Error('Revision token is missing.');
  var rowNumber = findRowByValue_(sheet, COL.TOKEN_HASH, hashToken_(token));
  if (!rowNumber) return jsonResponse_({ ok: false, code: 'INVALID_LINK', error: 'This revision link is invalid or has expired.' });

  validateSubmissionData_(data);
  var previous = sheet.getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT).getValues()[0];
  var previousEmail = clean_(previous[COL.EMAIL - 1]);
  var revisionNumber = Number(previous[COL.REVISION_COUNT - 1] || 0) + 1;
  var revisedAt = payload.submittedAt ? new Date(payload.submittedAt) : new Date();
  var nextToken = createToken_();
  var firstName = clean_(data['first-name']);
  var lastName = clean_(data['last-name']);

  var updates = [
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
    clean_(data.consent)
  ];
  sheet.getRange(rowNumber, COL.LAST_NAME, 1, updates.length).setValues([updates]);
  sheet.getRange(rowNumber, COL.TOKEN_HASH).setValue(hashToken_(nextToken));
  sheet.getRange(rowNumber, COL.REVISION_COUNT).setValue(revisionNumber);
  sheet.getRange(rowNumber, COL.LAST_REVISED_AT).setValue(revisedAt);
  sheet.getRange(rowNumber, COL.LAST_REVISION_EVENT_ID).setValue(eventId);
  sheet.getRange(rowNumber, COL.CONFIRMATION_STATUS).setValue('Revision confirmation pending');

  var current = sheet.getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT).getValues()[0];
  appendHistory_(spreadsheet, current, eventId, revisionNumber, revisedAt, 'Revision');

  try {
    sendConfirmationEmail_(current, nextToken, properties, true);
    var newEmail = clean_(current[COL.EMAIL - 1]);
    if (previousEmail && previousEmail.toLowerCase() !== newEmail.toLowerCase()) {
      sendEmailChangedNotice_(previousEmail, current, properties);
    }
    sheet.getRange(rowNumber, COL.CONFIRMATION_STATUS).setValue('Revision confirmation sent');
    sheet.getRange(rowNumber, COL.CONFIRMATION_SENT_AT).setValue(new Date());
    sheet.getRange(rowNumber, COL.NOTES).setValue('');
  } catch (error) {
    sheet.getRange(rowNumber, COL.CONFIRMATION_STATUS).setValue('Revision confirmation failed');
    sheet.getRange(rowNumber, COL.NOTES).setValue('Revision email error: ' + String(error.message || error));
    throw error;
  }

  return jsonResponse_({ ok: true, duplicate: false, submissionId: clean_(current[0]), revisionCount: revisionNumber });
}

function issueTokenAndSend_(sheet, rowNumber, properties, isRevision) {
  var token = createToken_();
  sheet.getRange(rowNumber, COL.TOKEN_HASH).setValue(hashToken_(token));
  var row = sheet.getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT).getValues()[0];
  sendConfirmationEmail_(row, token, properties, isRevision);
  sheet.getRange(rowNumber, COL.CONFIRMATION_STATUS).setValue(isRevision ? 'Revision confirmation sent' : 'Confirmation sent');
  sheet.getRange(rowNumber, COL.CONFIRMATION_SENT_AT).setValue(new Date());
  sheet.getRange(rowNumber, COL.NOTES).setValue('');
}

function sendConfirmationEmail_(row, token, properties, isRevision) {
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('No remaining daily email quota.');

  var submissionId = clean_(row[COL.SUBMISSION_ID - 1]);
  var recipient = clean_(row[COL.EMAIL - 1]);
  var name = clean_(row[COL.FULL_NAME - 1]);
  var title = clean_(row[COL.TITLE - 1]);
  var siteUrl = (properties.getProperty('SITE_URL') || SITE_URL_DEFAULT).replace(/\/$/, '');
  var editUrl = siteUrl + '/revise-abstract.html?token=' + encodeURIComponent(token);
  var deadline = Utilities.formatDate(revisionDeadline_(properties), 'Asia/Seoul', 'MMMM d, yyyy, h:mm a z');
  var subject = isRevision
    ? '[PBAST10] Abstract revision confirmed — ' + submissionId
    : '[PBAST10] Abstract submission confirmed — ' + submissionId;
  var intro = isRevision
    ? 'Your revised abstract has been received successfully.'
    : 'Your abstract has been received successfully.';
  var plainBody = [
    'Dear ' + (name || 'Participant') + ',',
    '',
    intro,
    '',
    'Submission ID: ' + submissionId,
    'Abstract title: ' + title,
    '',
    'Review or revise your abstract before ' + deadline + ':',
    editUrl,
    '',
    'Keep this private link secure. It provides access to your submission.',
    '',
    'PBAST10 Organizing Committee'
  ].join('\n');
  var htmlBody = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#12233a;max-width:640px">' +
    '<h2 style="color:#003876">PBAST10 Abstract ' + (isRevision ? 'Revision' : 'Submission') + ' Confirmation</h2>' +
    '<p>Dear ' + html_(name || 'Participant') + ',</p>' +
    '<p>' + html_(intro) + '</p>' +
    '<table style="border-collapse:collapse;width:100%;margin:20px 0">' +
      '<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">Submission ID</th><td style="padding:8px;border-bottom:1px solid #ddd">' + html_(submissionId) + '</td></tr>' +
      '<tr><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd">Abstract title</th><td style="padding:8px;border-bottom:1px solid #ddd">' + html_(title) + '</td></tr>' +
    '</table>' +
    '<p><a href="' + html_(editUrl) + '" style="display:inline-block;background:#003876;color:#fff;text-decoration:none;padding:12px 20px">Review or Revise Your Abstract</a></p>' +
    '<p style="font-size:13px;color:#6b6355">Revisions close on ' + html_(deadline) + '. Keep this private link secure because it provides access to your submission.</p>' +
    '<p>PBAST10 Organizing Committee</p></div>';

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    name: 'PBAST10 Organizing Committee',
    replyTo: properties.getProperty('REPLY_TO_EMAIL') || REPLY_TO_DEFAULT
  });
}

function sendEmailChangedNotice_(oldEmail, row, properties) {
  if (MailApp.getRemainingDailyQuota() < 1) return;
  var submissionId = clean_(row[COL.SUBMISSION_ID - 1]);
  MailApp.sendEmail({
    to: oldEmail,
    subject: '[PBAST10] Submission email address changed — ' + submissionId,
    body: 'The contact email address for PBAST10 abstract ' + submissionId + ' was changed during a revision. If you did not make this change, reply to this email immediately.\n\nPBAST10 Organizing Committee',
    name: 'PBAST10 Organizing Committee',
    replyTo: properties.getProperty('REPLY_TO_EMAIL') || REPLY_TO_DEFAULT
  });
}

function appendHistory_(spreadsheet, trackerRow, eventId, revisionNumber, recordedAt, eventType) {
  var history = spreadsheet.getSheetByName(HISTORY_SHEET);
  if (!history) history = spreadsheet.insertSheet(HISTORY_SHEET);
  if (history.getLastRow() === 0) {
    history.appendRow([
      'Submission ID', 'Event ID', 'Revision Number', 'Recorded At', 'Event Type',
      'Last Name', 'First Name', 'Full Name', 'Email', 'Institution / Affiliation',
      'Country / Region', 'Presentation Preference', 'Primary Topic', 'Abstract Title',
      'Co-authors', 'Abstract File URL', 'Consent'
    ]);
    history.setFrozenRows(1);
  }
  history.appendRow([
    clean_(trackerRow[COL.SUBMISSION_ID - 1]),
    eventId,
    revisionNumber,
    recordedAt,
    eventType,
    clean_(trackerRow[COL.LAST_NAME - 1]),
    clean_(trackerRow[COL.FIRST_NAME - 1]),
    clean_(trackerRow[COL.FULL_NAME - 1]),
    clean_(trackerRow[COL.EMAIL - 1]),
    clean_(trackerRow[COL.AFFILIATION - 1]),
    clean_(trackerRow[COL.COUNTRY - 1]),
    clean_(trackerRow[COL.PRESENTATION - 1]),
    clean_(trackerRow[COL.TOPIC - 1]),
    clean_(trackerRow[COL.TITLE - 1]),
    clean_(trackerRow[COL.COAUTHORS - 1]),
    clean_(trackerRow[COL.FILE_URL - 1]),
    clean_(trackerRow[COL.CONSENT - 1])
  ]);
}

function ensureTrackerHeaders_(sheet) {
  var requiredColumns = COL.CONFIRMATION_SENT_AT;
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
  var headers = [['Edit Token Hash', 'Revision Count', 'Last Revised At', 'Last Revision Event ID', 'Confirmation Email Status', 'Confirmation Email Sent At']];
  sheet.getRange(1, COL.TOKEN_HASH, 1, headers[0].length).setValues(headers);
}

function editableDataFromRow_(row) {
  return {
    submissionId: clean_(row[COL.SUBMISSION_ID - 1]),
    lastName: clean_(row[COL.LAST_NAME - 1]),
    firstName: clean_(row[COL.FIRST_NAME - 1]),
    email: clean_(row[COL.EMAIL - 1]),
    affiliation: clean_(row[COL.AFFILIATION - 1]),
    country: clean_(row[COL.COUNTRY - 1]),
    presentationPreference: clean_(row[COL.PRESENTATION - 1]),
    primaryTopic: clean_(row[COL.TOPIC - 1]),
    abstractTitle: clean_(row[COL.TITLE - 1]),
    coAuthors: clean_(row[COL.COAUTHORS - 1]),
    currentFileUrl: clean_(row[COL.FILE_URL - 1])
  };
}

function validateSubmissionData_(data) {
  var required = [
    'last-name', 'first-name', 'email', 'affiliation', 'country',
    'presentation-preference', 'primary-topic', 'abstract-title', 'abstract-file', 'consent'
  ];
  for (var i = 0; i < required.length; i++) {
    if (!clean_(data[required[i]])) throw new Error('Required field is missing: ' + required[i]);
  }
  var email = clean_(data.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email address is invalid.');
}

function findRowByValue_(sheet, column, value) {
  if (!value || sheet.getLastRow() < 2) return 0;
  var match = sheet.getRange(2, column, sheet.getLastRow() - 1, 1)
    .createTextFinder(value)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function revisionDeadline_(properties) {
  var configured = properties.getProperty('REVISION_DEADLINE') || REVISION_DEADLINE_DEFAULT;
  var deadline = new Date(configured);
  if (isNaN(deadline.getTime())) throw new Error('REVISION_DEADLINE is invalid. Use an ISO 8601 timestamp.');
  return deadline;
}

function isRevisionClosed_(properties) {
  return new Date().getTime() > revisionDeadline_(properties).getTime();
}

function createToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function hashToken_(token) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (value) {
    var byte = value < 0 ? value + 256 : value;
    return ('0' + byte.toString(16)).slice(-2);
  }).join('');
}

function secureEquals_(left, right) {
  if (left.length !== right.length) return false;
  var result = 0;
  for (var i = 0; i < left.length; i++) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return result === 0;
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

function html_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonResponse_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

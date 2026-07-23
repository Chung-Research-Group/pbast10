/**
 * PBAST10 Netlify Forms -> Google Sheets receiver.
 *
 * Run initializePBAST10() once while signed in as secretariat@pbast10.org.
 * It creates a new tracker spreadsheet and all required script properties.
 *
 * Optional script properties:
 *   SITE_URL, REPLY_TO_EMAIL, REVISION_DEADLINE
 */
var TRACKER_SHEET = 'Abstract Tracker';
var HISTORY_SHEET = 'Revision History';
var SUMMARY_SHEET = 'Summary';
var LISTS_SHEET = 'Lists';
var TRACKER_MAX_ROWS = 1000;
var SITE_URL_DEFAULT = 'https://pbast10.org';
var REPLY_TO_DEFAULT = 'secretariat@pbast10.org';
var REVISION_DEADLINE_DEFAULT = '2026-11-30T23:59:59+09:00';
var TRACKER_HEADERS = [
  'Submission ID', 'Submitted At', 'Last Name', 'First Name', 'Full Name',
  'Email', 'Institution / Affiliation', 'Country / Region',
  'Presentation Preference', 'Primary Topic', 'Abstract Title', 'Co-authors',
  'Abstract File URL', 'Consent', 'Intake Status', 'Reviewer 1',
  'Reviewer 1 Decision', 'Reviewer 2', 'Reviewer 2 Decision', 'Final Decision',
  'Final Presentation Type', 'Notification Status', 'Notes', 'Edit Token Hash',
  'Revision Count', 'Last Revised At', 'Last Revision Event ID',
  'Confirmation Email Status', 'Confirmation Email Sent At'
];

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
  FINAL_DECISION: 20,
  FINAL_PRESENTATION_TYPE: 21,
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

    // Do not let unauthenticated callers occupy the shared write lock.
    lock.waitLock(30000);

    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getSheetByName(TRACKER_SHEET);
    if (!sheet) {
      return jsonResponse_({ ok: false, error: 'Abstract Tracker sheet was not found.' });
    }

    ensureTrackerHeaders_(sheet);
    var action = clean_(payload.action) || 'create';

    if (action === 'admin-list') return adminList_(sheet);
    if (action === 'admin-update') return adminUpdate_(sheet, payload);
    if (action === 'admin-reviewer-invite') return adminReviewerInvite_(payload, properties);
    if (action === 'get') return getSubmission_(sheet, payload, properties);
    if (action === 'withdraw') return withdrawSubmission_(spreadsheet, sheet, payload, properties);
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

/**
 * Creates a clean PBAST10 tracker and generates the Netlify shared secret.
 * This function is idempotent: running it again reuses the configured
 * spreadsheet and does not replace an existing secret or submission data.
 */
function initializePBAST10() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  var spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('PBAST10 Abstract Submission Tracker');
    spreadsheetId = spreadsheet.getId();
    properties.setProperty('SPREADSHEET_ID', spreadsheetId);
  }

  if (!properties.getProperty('SYNC_SECRET')) {
    properties.setProperty('SYNC_SECRET', createSyncSecret_());
  }
  if (!properties.getProperty('SITE_URL')) {
    properties.setProperty('SITE_URL', SITE_URL_DEFAULT);
  }
  if (!properties.getProperty('REPLY_TO_EMAIL')) {
    properties.setProperty('REPLY_TO_EMAIL', REPLY_TO_DEFAULT);
  }
  if (!properties.getProperty('REVISION_DEADLINE')) {
    properties.setProperty('REVISION_DEADLINE', REVISION_DEADLINE_DEFAULT);
  }

  var tracker = spreadsheet.getSheetByName(TRACKER_SHEET);
  if (!tracker) {
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      tracker = sheets[0];
      tracker.setName(TRACKER_SHEET);
    } else {
      tracker = spreadsheet.insertSheet(TRACKER_SHEET);
    }
  }
  ensureListsSheet_(spreadsheet);
  ensureTrackerSheet_(tracker, spreadsheet);
  ensureHistoryHeaders_(spreadsheet);
  ensureSummarySheet_(spreadsheet);

  var result = {
    spreadsheetUrl: spreadsheet.getUrl(),
    spreadsheetId: spreadsheetId,
    syncSecret: properties.getProperty('SYNC_SECRET'),
    replyTo: properties.getProperty('REPLY_TO_EMAIL'),
    revisionDeadline: properties.getProperty('REVISION_DEADLINE')
  };
  Logger.log('PBAST10 setup complete. Copy these values to Netlify:');
  Logger.log('GOOGLE_SHEETS_WEBHOOK_URL = add the /exec URL after deploying this script as a web app');
  Logger.log('SHEETS_SYNC_SECRET = ' + result.syncSecret);
  Logger.log('Spreadsheet = ' + result.spreadsheetUrl);
  return result;
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
    sheetText_(lastName),
    sheetText_(firstName),
    sheetText_(formatName_(lastName, firstName)),
    sheetText_(data.email),
    sheetText_(data.affiliation),
    sheetText_(data.country),
    sheetText_(data['presentation-preference']),
    sheetText_(data['primary-topic']),
    sheetText_(data['abstract-title']),
    sheetText_(data['co-authors']),
    fileUrl_(data['abstract-file']),
    sheetText_(data.consent),
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
  if (clean_(previous[COL.INTAKE_STATUS - 1]) === 'Withdrawn') {
    return jsonResponse_({ ok: false, code: 'SUBMISSION_WITHDRAWN', error: 'This abstract has been withdrawn. Contact the secretariat to request reinstatement.' });
  }
  var previousEmail = clean_(previous[COL.EMAIL - 1]);
  var revisionNumber = Number(previous[COL.REVISION_COUNT - 1] || 0) + 1;
  var revisedAt = payload.submittedAt ? new Date(payload.submittedAt) : new Date();
  var nextToken = createToken_();
  var firstName = clean_(data['first-name']);
  var lastName = clean_(data['last-name']);

  var updates = [
    sheetText_(lastName),
    sheetText_(firstName),
    sheetText_(formatName_(lastName, firstName)),
    sheetText_(data.email),
    sheetText_(data.affiliation),
    sheetText_(data.country),
    sheetText_(data['presentation-preference']),
    sheetText_(data['primary-topic']),
    sheetText_(data['abstract-title']),
    sheetText_(previous[COL.COAUTHORS - 1]),
    fileUrl_(data['abstract-file']),
    sheetText_(data.consent)
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

function withdrawSubmission_(spreadsheet, sheet, payload, properties) {
  if (isRevisionClosed_(properties)) {
    return jsonResponse_({ ok: false, code: 'REVISION_CLOSED', error: 'The abstract revision and withdrawal period has closed.' });
  }

  var token = clean_(payload.token);
  if (!token) return jsonResponse_({ ok: false, code: 'INVALID_LINK', error: 'This revision link is invalid or has expired.' });

  var rowNumber = findRowByValue_(sheet, COL.TOKEN_HASH, hashToken_(token));
  if (!rowNumber) return jsonResponse_({ ok: false, code: 'INVALID_LINK', error: 'This revision link is invalid or has expired.' });

  var row = sheet.getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT).getValues()[0];
  if (clean_(row[COL.INTAKE_STATUS - 1]) === 'Withdrawn') {
    return jsonResponse_({ ok: true, duplicate: true, submission: editableDataFromRow_(row) });
  }

  var withdrawnAt = new Date();
  var eventId = 'withdrawal-' + Utilities.getUuid();
  var revisionNumber = Number(row[COL.REVISION_COUNT - 1] || 0);
  var existingNotes = clean_(row[COL.NOTES - 1]);
  var withdrawalNote = 'Withdrawn by submitter on ' + withdrawnAt.toISOString();

  sheet.getRange(rowNumber, COL.INTAKE_STATUS).setValue('Withdrawn');
  sheet.getRange(rowNumber, COL.FINAL_DECISION).setValue('Withdrawn');
  sheet.getRange(rowNumber, COL.FINAL_PRESENTATION_TYPE).setValue('None');
  sheet.getRange(rowNumber, COL.NOTES).setValue(existingNotes ? existingNotes + '\n' + withdrawalNote : withdrawalNote);

  row = sheet.getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT).getValues()[0];
  appendHistory_(spreadsheet, row, eventId, revisionNumber, withdrawnAt, 'Withdrawal');

  var emailSent = true;
  try {
    sendWithdrawalEmail_(row, properties);
  } catch (error) {
    emailSent = false;
    var note = clean_(sheet.getRange(rowNumber, COL.NOTES).getValue());
    sheet.getRange(rowNumber, COL.NOTES).setValue(note + '\nWithdrawal email error: ' + String(error.message || error));
    console.error(error);
  }

  return jsonResponse_({
    ok: true,
    duplicate: false,
    emailSent: emailSent,
    submission: editableDataFromRow_(row)
  });
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
  // A URL fragment is not included in HTTP requests or server access logs.
  var editUrl = siteUrl + '/revise-abstract.html#token=' + encodeURIComponent(token);
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
    'Review, revise, or withdraw your abstract before ' + deadline + ':',
    editUrl,
    '',
    'Keep this private link secure. It provides access to your submission.',
    '',
    'PBAST10 Organizing Committee',
    'Contact: ' + (properties.getProperty('REPLY_TO_EMAIL') || REPLY_TO_DEFAULT)
  ].join('\n');
  var htmlBody = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#12233a;max-width:640px">' +
    '<h2 style="color:#003876">PBAST10 Abstract ' + (isRevision ? 'Revision' : 'Submission') + ' Confirmation</h2>' +
    '<p>Dear ' + html_(name || 'Participant') + ',</p>' +
    '<p>' + html_(intro) + '</p>' +
    '<p><strong>Abstract title:</strong> ' + html_(title) + '<br>' +
    '<strong>Submission ID:</strong> ' + html_(submissionId) + '</p>' +
    '<p style="margin:28px 0"><a href="' + html_(editUrl) + '" ' +
    'style="background:#003876;color:#ffffff;text-decoration:none;padding:14px 22px;' +
    'display:inline-block;font-weight:bold">Review, Revise, or Withdraw Your Abstract</a></p>' +
    '<p style="font-size:13px;color:#6b6355">Revisions close on ' + html_(deadline) + '. Keep this private link secure because it provides access to your submission.</p>' +
    '<p>PBAST10 Organizing Committee<br>Contact: ' +
    html_(properties.getProperty('REPLY_TO_EMAIL') || REPLY_TO_DEFAULT) + '</p></div>';

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
    subject: 'PBAST10 Submission Email Address Changed',
    body: 'The contact email address for PBAST10 abstract ' + submissionId + ' was changed during a revision. If you did not make this change, reply to this email immediately.\n\nPBAST10 Organizing Committee',
    name: 'PBAST10 Organizing Committee',
    replyTo: properties.getProperty('REPLY_TO_EMAIL') || REPLY_TO_DEFAULT
  });
}

function sendWithdrawalEmail_(row, properties) {
  var submissionId = clean_(row[COL.SUBMISSION_ID - 1]);
  var recipient = clean_(row[COL.EMAIL - 1]);
  var name = clean_(row[COL.FULL_NAME - 1]);
  var title = clean_(row[COL.TITLE - 1]);
  var replyTo = properties.getProperty('REPLY_TO_EMAIL') || REPLY_TO_DEFAULT;
  var subject = '[PBAST10] Abstract withdrawn — ' + submissionId;
  var plainBody = [
    'Dear ' + (name || 'Participant') + ',',
    '',
    'Your abstract has been withdrawn and will not be sent for review.',
    '',
    'Submission ID: ' + submissionId,
    'Abstract title: ' + title,
    '',
    'To request reinstatement, contact ' + replyTo + '.',
    '',
    'PBAST10 Organizing Committee'
  ].join('\n');
  var htmlBody = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#12233a;max-width:640px">' +
    '<h2 style="color:#003876">PBAST10 Abstract Withdrawal Confirmation</h2>' +
    '<p>Dear ' + html_(name || 'Participant') + ',</p>' +
    '<p>Your abstract has been withdrawn and will not be sent for review.</p>' +
    '<p><strong>Abstract title:</strong> ' + html_(title) + '<br>' +
    '<strong>Submission ID:</strong> ' + html_(submissionId) + '</p>' +
    '<p>To request reinstatement, contact ' + html_(replyTo) + '.</p>' +
    '<p>PBAST10 Organizing Committee</p></div>';

  if (typeof sendViaBrevo_ === 'function') {
    return sendViaBrevo_({
      to: recipient,
      toName: name,
      subject: subject,
      textContent: plainBody,
      htmlContent: htmlBody,
      replyTo: replyTo
    }, properties);
  }

  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    name: 'PBAST10 Organizing Committee',
    replyTo: replyTo
  });
}

function appendHistory_(spreadsheet, trackerRow, eventId, revisionNumber, recordedAt, eventType) {
  var history = ensureHistoryHeaders_(spreadsheet);
  history.appendRow([
    clean_(trackerRow[COL.SUBMISSION_ID - 1]),
    eventId,
    revisionNumber,
    recordedAt,
    eventType,
    sheetText_(trackerRow[COL.LAST_NAME - 1]),
    sheetText_(trackerRow[COL.FIRST_NAME - 1]),
    sheetText_(trackerRow[COL.FULL_NAME - 1]),
    sheetText_(trackerRow[COL.EMAIL - 1]),
    sheetText_(trackerRow[COL.AFFILIATION - 1]),
    sheetText_(trackerRow[COL.COUNTRY - 1]),
    sheetText_(trackerRow[COL.PRESENTATION - 1]),
    sheetText_(trackerRow[COL.TOPIC - 1]),
    sheetText_(trackerRow[COL.TITLE - 1]),
    sheetText_(trackerRow[COL.COAUTHORS - 1]),
    clean_(trackerRow[COL.FILE_URL - 1]),
    sheetText_(trackerRow[COL.CONSENT - 1])
  ]);
}

function ensureTrackerHeaders_(sheet) {
  var requiredColumns = TRACKER_HEADERS.length;
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
  sheet.getRange(1, 1, 1, TRACKER_HEADERS.length).setValues([TRACKER_HEADERS]);
  sheet.setFrozenRows(1);
}

function ensureTrackerSheet_(sheet, spreadsheet) {
  ensureTrackerHeaders_(sheet);

  if (sheet.getMaxRows() < TRACKER_MAX_ROWS) {
    sheet.insertRowsAfter(sheet.getMaxRows(), TRACKER_MAX_ROWS - sheet.getMaxRows());
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.getRange(1, 1, 1, TRACKER_HEADERS.length)
    .setBackground('#e2e3e5')
    .setFontWeight('bold')
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.setRowHeight(1, 32);
  sheet.getRange(2, COL.SUBMITTED_AT, TRACKER_MAX_ROWS - 1, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(2, COL.LAST_REVISED_AT, TRACKER_MAX_ROWS - 1, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sheet.getRange(2, COL.CONFIRMATION_SENT_AT, TRACKER_MAX_ROWS - 1, 1)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');

  var widths = [
    190, 145, 105, 105, 145, 190, 210, 145, 145, 220,
    260, 220, 300, 90, 115, 150, 150, 150, 150, 130,
    150, 140, 240, 120, 100, 145, 150, 160, 170
  ];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);

  var existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  sheet.getRange(1, 1, TRACKER_MAX_ROWS, COL.NOTES).createFilter();

  var lists = spreadsheet.getSheetByName(LISTS_SHEET);
  var validationBuilder = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
  sheet.getRange(2, COL.INTAKE_STATUS, TRACKER_MAX_ROWS - 1, 1)
    .setDataValidation(validationBuilder.requireValueInRange(lists.getRange('A2:A5'), true).build());
  sheet.getRange(2, 17, TRACKER_MAX_ROWS - 1, 1)
    .setDataValidation(validationBuilder.requireValueInRange(lists.getRange('B2:B6'), true).build());
  sheet.getRange(2, 19, TRACKER_MAX_ROWS - 1, 1)
    .setDataValidation(validationBuilder.requireValueInRange(lists.getRange('B2:B6'), true).build());
  sheet.getRange(2, 20, TRACKER_MAX_ROWS - 1, 1)
    .setDataValidation(validationBuilder.requireValueInRange(lists.getRange('C2:C5'), true).build());
  sheet.getRange(2, 21, TRACKER_MAX_ROWS - 1, 1)
    .setDataValidation(validationBuilder.requireValueInRange(lists.getRange('D2:D5'), true).build());
  sheet.getRange(2, 22, TRACKER_MAX_ROWS - 1, 1)
    .setDataValidation(validationBuilder.requireValueInRange(lists.getRange('E2:E5'), true).build());

  var rules = sheet.getConditionalFormatRules().filter(function (rule) {
    var ranges = rule.getRanges();
    for (var r = 0; r < ranges.length; r++) {
      var column = ranges[r].getColumn();
      if (column === COL.INTAKE_STATUS || column === 20 || column === 22) return false;
    }
    return true;
  });
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Incomplete')
      .setBackground('#f4cccc')
      .setRanges([sheet.getRange('O2:O' + TRACKER_MAX_ROWS)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Accept')
      .setBackground('#d9ead3')
      .setRanges([sheet.getRange('T2:T' + TRACKER_MAX_ROWS)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Reject')
      .setBackground('#f4cccc')
      .setRanges([sheet.getRange('T2:T' + TRACKER_MAX_ROWS)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Sent')
      .setBackground('#cfe2f3')
      .setRanges([sheet.getRange('V2:V' + TRACKER_MAX_ROWS)])
      .build()
  );
  sheet.setConditionalFormatRules(rules);
  sheet.setTabColor('#6d9eeb');
}

function ensureListsSheet_(spreadsheet) {
  var lists = spreadsheet.getSheetByName(LISTS_SHEET);
  if (!lists) lists = spreadsheet.insertSheet(LISTS_SHEET);

  var values = [
    ['Intake Status', 'Review Decision', 'Final Decision', 'Presentation Type', 'Notification Status'],
    ['New', 'Accept Oral', 'Pending', 'Pending', 'Not Sent'],
    ['Checked', 'Accept Poster', 'Accept', 'Oral', 'Sent'],
    ['Incomplete', 'Revise', 'Reject', 'Poster', 'Confirmed'],
    ['Withdrawn', 'Reject', 'Withdrawn', 'None', 'Failed'],
    ['', 'Conflict', '', '', '']
  ];
  lists.getRange(1, 1, values.length, values[0].length).setValues(values);
  lists.getRange(1, 1, 1, values[0].length)
    .setBackground('#e2e3e5')
    .setFontWeight('bold');
  lists.setFrozenRows(1);
  lists.autoResizeColumns(1, values[0].length);
  if (!lists.isSheetHidden()) lists.hideSheet();
  return lists;
}

function ensureHistoryHeaders_(spreadsheet) {
  var history = spreadsheet.getSheetByName(HISTORY_SHEET);
  if (!history) history = spreadsheet.insertSheet(HISTORY_SHEET);
  if (history.getLastRow() === 0) {
    history.appendRow([
      'Submission ID', 'Event ID', 'Revision Number', 'Recorded At', 'Event Type',
      'Last Name', 'First Name', 'Full Name', 'Email', 'Institution / Affiliation',
      'Country / Region', 'Presentation Preference', 'Primary Topic', 'Abstract Title',
      'Co-authors', 'Abstract File URL', 'Consent'
    ]);
  }
  history.setFrozenRows(1);
  return history;
}

function ensureSummarySheet_(spreadsheet) {
  var summary = spreadsheet.getSheetByName(SUMMARY_SHEET);
  if (!summary) summary = spreadsheet.insertSheet(SUMMARY_SHEET, 0);

  var trackerRef = "'" + TRACKER_SHEET.replace(/'/g, "''") + "'";
  var rows = [
    ['PBAST10 Abstract Submission Summary', '', '', ''],
    ['', '', '', ''],
    ['Metric', 'Count', '', ''],
    ['Total submissions', '=COUNTA(' + trackerRef + '!A2:A' + TRACKER_MAX_ROWS + ')', '', ''],
    ['New / unchecked', '=COUNTIF(' + trackerRef + '!O2:O' + TRACKER_MAX_ROWS + ',"New")', '', ''],
    ['Accepted', '=COUNTIF(' + trackerRef + '!T2:T' + TRACKER_MAX_ROWS + ',"Accept")', '', ''],
    ['Oral', '=COUNTIF(' + trackerRef + '!U2:U' + TRACKER_MAX_ROWS + ',"Oral")', '', ''],
    ['Poster', '=COUNTIF(' + trackerRef + '!U2:U' + TRACKER_MAX_ROWS + ',"Poster")', '', ''],
    ['Rejected', '=COUNTIF(' + trackerRef + '!T2:T' + TRACKER_MAX_ROWS + ',"Reject")', '', ''],
    ['Notifications sent', '=COUNTIF(' + trackerRef + '!V2:V' + TRACKER_MAX_ROWS + ',"Sent")+COUNTIF(' + trackerRef + '!V2:V' + TRACKER_MAX_ROWS + ',"Confirmed")', '', ''],
    ['', '', '', ''],
    ['Workflow notes', '', '', ''],
    [1, 'Netlify automatically appends verified submissions to Abstract Tracker.', '', ''],
    [2, 'Committee members assign reviewers and record decisions in columns P–V.', '', ''],
    [3, 'Keep Netlify as the source backup and archive files after the deadline.', '', '']
  ];

  summary.getRange(1, 1, rows.length, 4).breakApart().clearContent().setValues(rows);
  summary.getRange('A1:D1').merge();
  summary.getRange('A12:D12').merge();
  summary.getRange('B13:D15').mergeAcross();

  summary.getRange('A1:D1')
    .setBackground('#d9e2f3')
    .setFontSize(16)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  summary.getRange('A3:B3')
    .setBackground('#e2e3e5')
    .setFontWeight('bold');
  summary.getRange('A12:D12')
    .setBackground('#e2e3e5')
    .setFontWeight('bold');
  summary.getRange('A3:B10').setBorder(true, true, true, true, true, true);
  summary.getRange('A13:D15').setBorder(true, true, true, true, true, true);
  summary.getRange('B4:B10').setNumberFormat('0').setHorizontalAlignment('right');
  summary.getRange('A1:D15').setVerticalAlignment('middle');
  summary.setColumnWidth(1, 265);
  summary.setColumnWidth(2, 520);
  summary.setColumnWidths(3, 2, 120);
  summary.setRowHeight(1, 44);
  summary.setFrozenRows(1);
  summary.setTabColor('#3c78d8');
  return summary;
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
    intakeStatus: clean_(row[COL.INTAKE_STATUS - 1]),
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
  validatePdfFile_(data['abstract-file']);
}

function fileUrl_(value) {
  return fileInfo_(value).url;
}

function validatePdfFile_(value) {
  var file = fileInfo_(value);
  if (!/\.pdf$/i.test(file.filename)) throw new Error('Only PDF abstract files are accepted.');
  if (!isFinite(file.size) || file.size < 1 || file.size > 7.5 * 1024 * 1024) {
    throw new Error('The PDF abstract file must be no larger than 7.5 MB.');
  }
  if (file.mime && file.mime !== 'application/pdf') throw new Error('The uploaded file is not a PDF.');
  if (!/^https:\/\/[^\s/]+\/.+/i.test(file.url)) throw new Error('Abstract upload URL is invalid.');
}

function fileInfo_(value) {
  var parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (error) { throw new Error('Abstract upload metadata is invalid.'); }
  }
  if (Array.isArray(parsed)) parsed = parsed.length ? parsed[0] : null;
  if (!parsed || typeof parsed !== 'object') throw new Error('A PDF abstract file is required.');
  return {
    filename: clean_(parsed.filename || parsed.name),
    size: Number(parsed.size),
    mime: clean_(parsed.content_type || parsed.contentType || parsed.mime_type || parsed.mimeType).toLowerCase(),
    url: clean_(parsed.url || parsed.secure_url)
  };
}

// Run this once from the Apps Script editor to grant spreadsheet and email access.
function authorizePBAST10() {
  var properties = PropertiesService.getScriptProperties();
  var spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID is missing.');
  SpreadsheetApp.openById(spreadsheetId).getName();
  Logger.log('Remaining email quota: ' + MailApp.getRemainingDailyQuota());
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

function createSyncSecret_() {
  return (
    Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()
  ).replace(/-/g, '');
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

// Prevent user-controlled values from being interpreted as Google Sheets
// formulas. The apostrophe is Sheets' explicit plain-text marker.
function sheetText_(value) {
  var text = clean_(value);
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
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

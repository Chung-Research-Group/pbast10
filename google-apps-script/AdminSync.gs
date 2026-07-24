/**
 * Administrator-only list and update helpers for the PBAST10 dashboard.
 *
 * These functions are reached only through doPost after Code.gs has validated
 * the existing SYNC_SECRET. Edit-token hashes and consent values are never
 * returned.
 */
var ADMIN_SYNC_MAX_ROWS = 2000;

var ADMIN_ALLOWED_VALUES = {
  intakeStatus: ['New', 'Checked', 'Incomplete', 'Withdrawn'],
  reviewerDecision: ['', 'Accept Oral', 'Accept Poster', 'Revise', 'Reject', 'Conflict'],
  finalDecision: ['Pending', 'Accept', 'Reject', 'Withdrawn'],
  presentationType: ['Pending', 'Oral', 'Poster', 'None'],
  notificationStatus: ['Not Sent', 'Sent', 'Confirmed', 'Failed']
};

function adminList_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return jsonResponse_({ ok: true, rows: [], generatedAt: new Date().toISOString() });
  }
  if (lastRow - 1 > ADMIN_SYNC_MAX_ROWS) {
    throw new Error('The tracker exceeds the administrator sync limit.');
  }

  var values = sheet
    .getRange(2, 1, lastRow - 1, COL.CONFIRMATION_SENT_AT)
    .getValues();
  var rows = values
    .filter(function (row) { return clean_(row[COL.SUBMISSION_ID - 1]); })
    .map(adminRowFromValues_);

  return jsonResponse_({
    ok: true,
    rows: rows,
    generatedAt: new Date().toISOString()
  });
}

function adminUpdate_(sheet, payload) {
  var submissionId = clean_(payload.submissionId);
  var expectedFingerprint = clean_(payload.expectedFingerprint);
  var changes = payload.changes || {};
  if (!submissionId) throw new Error('Submission ID is required.');

  var rowNumber = findRowByValue_(sheet, COL.SUBMISSION_ID, submissionId);
  if (!rowNumber) {
    return jsonResponse_({
      ok: false,
      code: 'NOT_FOUND',
      error: 'The abstract was not found in Google Sheets.'
    });
  }

  var current = sheet
    .getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT)
    .getValues()[0];
  var currentFingerprint = adminFingerprint_(current);
  if (
    expectedFingerprint &&
    !secureEquals_(expectedFingerprint, currentFingerprint)
  ) {
    return jsonResponse_({
      ok: false,
      code: 'SYNC_CONFLICT',
      error: 'This abstract changed in Google Sheets after it was opened. Synchronize and review the newer values.',
      row: adminRowFromValues_(current)
    });
  }

  var normalized = adminValidateChanges_(changes);
  sheet.getRange(rowNumber, COL.INTAKE_STATUS, 1, 9).setValues([[
    normalized.intakeStatus,
    sheetText_(normalized.reviewer1),
    normalized.reviewer1Decision,
    sheetText_(normalized.reviewer2),
    normalized.reviewer2Decision,
    normalized.finalDecision,
    normalized.finalPresentationType,
    normalized.notificationStatus,
    sheetText_(normalized.notes)
  ]]);

  var saved = sheet
    .getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT)
    .getValues()[0];
  return jsonResponse_({ ok: true, row: adminRowFromValues_(saved) });
}

function adminValidateChanges_(changes) {
  var normalized = {
    intakeStatus: clean_(changes.intakeStatus),
    reviewer1: clean_(changes.reviewer1),
    reviewer1Decision: clean_(changes.reviewer1Decision),
    reviewer2: clean_(changes.reviewer2),
    reviewer2Decision: clean_(changes.reviewer2Decision),
    finalDecision: clean_(changes.finalDecision),
    finalPresentationType: clean_(changes.finalPresentationType),
    notificationStatus: adminCanonicalNotification_(changes.notificationStatus),
    notes: clean_(changes.notes)
  };

  adminRequireAllowed_('intake status', normalized.intakeStatus, ADMIN_ALLOWED_VALUES.intakeStatus);
  adminRequireAllowed_('reviewer 1 decision', normalized.reviewer1Decision, ADMIN_ALLOWED_VALUES.reviewerDecision);
  adminRequireAllowed_('reviewer 2 decision', normalized.reviewer2Decision, ADMIN_ALLOWED_VALUES.reviewerDecision);
  adminRequireAllowed_('final decision', normalized.finalDecision, ADMIN_ALLOWED_VALUES.finalDecision);
  adminRequireAllowed_('presentation type', normalized.finalPresentationType, ADMIN_ALLOWED_VALUES.presentationType);
  adminRequireAllowed_('notification status', normalized.notificationStatus, ADMIN_ALLOWED_VALUES.notificationStatus);

  if (normalized.reviewer1.length > 320 || normalized.reviewer2.length > 320) {
    throw new Error('Reviewer names must be 320 characters or fewer.');
  }
  if (normalized.notes.length > 5000) {
    throw new Error('Internal notes must be 5,000 characters or fewer.');
  }
  if (
    normalized.finalDecision === 'Accept' &&
    ['Oral', 'Poster'].indexOf(normalized.finalPresentationType) === -1
  ) {
    throw new Error('Accepted abstracts must have Oral or Poster as the presentation type.');
  }
  if (
    ['Reject', 'Withdrawn'].indexOf(normalized.finalDecision) !== -1 &&
    normalized.finalPresentationType !== 'None'
  ) {
    throw new Error('Rejected or withdrawn abstracts must have None as the presentation type.');
  }
  return normalized;
}

function adminRequireAllowed_(label, value, allowed) {
  if (allowed.indexOf(value) === -1) {
    throw new Error('Invalid ' + label + '.');
  }
}

function adminCanonicalNotification_(value) {
  var text = clean_(value);
  if (text.toLowerCase() === 'not sent') return 'Not Sent';
  return text;
}

function adminRowFromValues_(row) {
  return {
    id: clean_(row[COL.SUBMISSION_ID - 1]),
    submittedAt: adminIso_(row[COL.SUBMITTED_AT - 1]),
    lastName: clean_(row[COL.LAST_NAME - 1]),
    firstName: clean_(row[COL.FIRST_NAME - 1]),
    email: clean_(row[COL.EMAIL - 1]),
    affiliation: clean_(row[COL.AFFILIATION - 1]),
    country: clean_(row[COL.COUNTRY - 1]),
    presentationPreference: clean_(row[COL.PRESENTATION - 1]),
    primaryTopic: clean_(row[COL.TOPIC - 1]),
    abstractTitle: clean_(row[COL.TITLE - 1]),
    coAuthors: clean_(row[COL.COAUTHORS - 1]),
    fileUrl: clean_(row[COL.FILE_URL - 1]),
    intakeStatus: clean_(row[COL.INTAKE_STATUS - 1]) || 'New',
    reviewer1: clean_(row[15]),
    reviewer1Decision: clean_(row[16]),
    reviewer2: clean_(row[17]),
    reviewer2Decision: clean_(row[18]),
    finalDecision: clean_(row[COL.FINAL_DECISION - 1]) || 'Pending',
    finalPresentationType: clean_(row[COL.FINAL_PRESENTATION_TYPE - 1]) || 'Pending',
    notificationStatus: adminCanonicalNotification_(row[21]) || 'Not Sent',
    notes: clean_(row[COL.NOTES - 1]),
    revisionCount: Number(row[COL.REVISION_COUNT - 1] || 0),
    lastRevisedAt: adminIso_(row[COL.LAST_REVISED_AT - 1]),
    sourceFingerprint: adminFingerprint_(row)
  };
}

function adminFingerprint_(row) {
  var safeValues = [
    clean_(row[COL.SUBMISSION_ID - 1]),
    adminIso_(row[COL.SUBMITTED_AT - 1]),
    clean_(row[COL.LAST_NAME - 1]),
    clean_(row[COL.FIRST_NAME - 1]),
    clean_(row[COL.EMAIL - 1]),
    clean_(row[COL.AFFILIATION - 1]),
    clean_(row[COL.COUNTRY - 1]),
    clean_(row[COL.PRESENTATION - 1]),
    clean_(row[COL.TOPIC - 1]),
    clean_(row[COL.TITLE - 1]),
    clean_(row[COL.COAUTHORS - 1]),
    clean_(row[COL.FILE_URL - 1]),
    clean_(row[COL.INTAKE_STATUS - 1]),
    clean_(row[15]),
    clean_(row[16]),
    clean_(row[17]),
    clean_(row[18]),
    clean_(row[COL.FINAL_DECISION - 1]),
    clean_(row[COL.FINAL_PRESENTATION_TYPE - 1]),
    adminCanonicalNotification_(row[21]),
    clean_(row[COL.NOTES - 1]),
    Number(row[COL.REVISION_COUNT - 1] || 0),
    adminIso_(row[COL.LAST_REVISED_AT - 1])
  ];
  return hashToken_(JSON.stringify(safeValues));
}

function adminIso_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return clean_(value);
}



/**
 * Removes selected abstracts after validating every current fingerprint.
 * Validation completes before any row is deleted, so a stale selection cannot
 * cause a partial removal. Rows are deleted from bottom to top.
 */
function adminDelete_(sheet, payload) {
  var items = payload.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    throw new Error('Select between 1 and 50 abstracts to remove.');
  }

  var seen = {};
  var resolved = [];
  for (var i = 0; i < items.length; i++) {
    var submissionId = clean_(items[i] && items[i].submissionId);
    var expectedFingerprint = clean_(items[i] && items[i].expectedFingerprint);
    if (!submissionId || seen[submissionId]) {
      throw new Error('The removal list contains an invalid or duplicate submission ID.');
    }
    seen[submissionId] = true;

    var rowNumber = findRowByValue_(sheet, COL.SUBMISSION_ID, submissionId);
    if (!rowNumber) {
      return jsonResponse_({
        ok: false,
        code: 'NOT_FOUND',
        error: 'The abstract ' + submissionId + ' was not found in Google Sheets.'
      });
    }
    var current = sheet
      .getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT)
      .getValues()[0];
    var currentFingerprint = adminFingerprint_(current);
    if (
      expectedFingerprint &&
      !secureEquals_(expectedFingerprint, currentFingerprint)
    ) {
      return jsonResponse_({
        ok: false,
        code: 'SYNC_CONFLICT',
        error: 'The abstract ' + submissionId + ' changed after it was selected. Synchronize and review the newer values.',
        row: adminRowFromValues_(current)
      });
    }
    resolved.push({ id: submissionId, rowNumber: rowNumber });
  }

  resolved.sort(function (left, right) {
    return right.rowNumber - left.rowNumber;
  });
  for (var j = 0; j < resolved.length; j++) {
    sheet.deleteRow(resolved[j].rowNumber);
  }

  return jsonResponse_({
    ok: true,
    deletedIds: items.map(function (item) {
      return clean_(item.submissionId);
    })
  });
}

/**
 * Sends one acceptance notification. The spreadsheet notification status is
 * the idempotency guard, preventing duplicate mail when an accepted record is
 * saved or retried more than once.
 */
function adminAcceptanceEmail_(sheet, payload, properties) {
  var submissionId = clean_(payload.submissionId);
  var expectedFingerprint = clean_(payload.expectedFingerprint);
  if (!submissionId) throw new Error('Submission ID is required.');

  var rowNumber = findRowByValue_(sheet, COL.SUBMISSION_ID, submissionId);
  if (!rowNumber) {
    return jsonResponse_({
      ok: false,
      code: 'NOT_FOUND',
      error: 'The abstract was not found in Google Sheets.'
    });
  }

  var current = sheet
    .getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT)
    .getValues()[0];
  var currentFingerprint = adminFingerprint_(current);
  if (
    expectedFingerprint &&
    !secureEquals_(expectedFingerprint, currentFingerprint)
  ) {
    return jsonResponse_({
      ok: false,
      code: 'SYNC_CONFLICT',
      error: 'This abstract changed before the acceptance email was sent.',
      row: adminRowFromValues_(current)
    });
  }

  var decision = clean_(current[COL.FINAL_DECISION - 1]);
  var presentationType = clean_(current[COL.FINAL_PRESENTATION_TYPE - 1]);
  var notificationStatus = adminCanonicalNotification_(
    current[COL.NOTIFICATION_STATUS - 1]
  );
  if (decision !== 'Accept') {
    throw new Error('Only accepted abstracts can receive an acceptance email.');
  }
  if (['Oral', 'Poster'].indexOf(presentationType) === -1) {
    throw new Error('Choose Oral or Poster before sending the acceptance email.');
  }
  if (['Sent', 'Confirmed'].indexOf(notificationStatus) !== -1) {
    return jsonResponse_({
      ok: true,
      delivered: true,
      duplicate: true,
      row: adminRowFromValues_(current)
    });
  }

  var email = clean_(current[COL.EMAIL - 1]).toLowerCase();
  var firstName = clean_(current[COL.FIRST_NAME - 1]);
  var lastName = clean_(current[COL.LAST_NAME - 1]);
  var fullName = formatName_(lastName, firstName);
  var title = clean_(current[COL.TITLE - 1]);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('The submitter email address is invalid.');
  }

  var subject = '[PBAST10] Abstract accepted — ' + submissionId;
  var text = [
    'Dear ' + (firstName || fullName) + ',',
    '',
    'We are pleased to inform you that your abstract has been accepted for presentation at the 10th Pacific Basin Conference on Adsorption Science & Technology (PBAST10).',
    '',
    'Submission ID: ' + submissionId,
    'Abstract title: ' + title,
    'Presentation type: ' + presentationType,
    '',
    'PBAST10 will be held May 31–June 3, 2027 at Yonsei University in Seoul, Republic of Korea.',
    'Detailed presentation and program instructions will be sent separately.',
    '',
    'If you have any questions, please contact secretariat@pbast10.org.',
    '',
    'PBAST10 Secretariat'
  ].join('\n');
  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:auto;color:#172535;line-height:1.65">' +
    '<div style="border-top:6px solid #003876;padding:30px;border-right:1px solid #dfe6ec;border-bottom:1px solid #dfe6ec;border-left:1px solid #dfe6ec">' +
    '<p>Dear ' + adminEscapeHtml_(firstName || fullName) + ',</p>' +
    '<p>We are pleased to inform you that your abstract has been <strong>accepted</strong> for presentation at the 10th Pacific Basin Conference on Adsorption Science &amp; Technology (PBAST10).</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:22px 0;background:#f4f7f9">' +
    adminInviteRow_('Submission ID', adminEscapeHtml_(submissionId)) +
    adminInviteRow_('Abstract title', adminEscapeHtml_(title)) +
    adminInviteRow_('Presentation type', '<strong>' + adminEscapeHtml_(presentationType) + '</strong>') +
    '</table>' +
    '<p>PBAST10 will be held <strong>May 31–June 3, 2027</strong> at Yonsei University in Seoul, Republic of Korea. Detailed presentation and program instructions will be sent separately.</p>' +
    '<p>If you have any questions, please contact <a href="mailto:secretariat@pbast10.org">secretariat@pbast10.org</a>.</p>' +
    '<p style="margin-top:28px">PBAST10 Secretariat</p>' +
    '</div></div>';

  try {
    sendTransactionalEmail_({
      to: email,
      toName: fullName,
      subject: subject,
      textContent: text,
      htmlContent: html,
      senderName: 'PBAST10 Secretariat',
      replyTo:
        properties.getProperty('REPLY_TO_EMAIL') ||
        'secretariat@pbast10.org'
    }, properties);
    sheet
      .getRange(rowNumber, COL.NOTIFICATION_STATUS)
      .setValue('Sent');
    current = sheet
      .getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT)
      .getValues()[0];
    return jsonResponse_({
      ok: true,
      delivered: true,
      sentAt: new Date().toISOString(),
      row: adminRowFromValues_(current)
    });
  } catch (error) {
    var errorMessage = clean_(error && error.message || error).slice(0, 300);
    sheet
      .getRange(rowNumber, COL.NOTIFICATION_STATUS)
      .setValue('Failed');
    current = sheet
      .getRange(rowNumber, 1, 1, COL.CONFIRMATION_SENT_AT)
      .getValues()[0];
    return jsonResponse_({
      ok: true,
      delivered: false,
      emailError:
        'The acceptance decision was saved, but email delivery failed' +
        (errorMessage ? ': ' + errorMessage : '.'),
      row: adminRowFromValues_(current)
    });
  }
}

/**
 * Sends one reviewer an individual temporary passcode and login instructions.
 * The caller has already passed the shared-secret check in Code.gs.
 */
function adminReviewerInvite_(payload, properties) {
  var email = clean_(payload.email).toLowerCase();
  var name = clean_(payload.name);
  var temporaryPasscode = clean_(payload.temporaryPasscode);
  var loginUrl = clean_(payload.loginUrl);
  var deadline = clean_(payload.deadline);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid reviewer email is required.');
  }
  if (!name || name.length > 200) {
    throw new Error('A valid reviewer name is required.');
  }
  if (!/^[A-Za-z0-9-]{12,32}$/.test(temporaryPasscode)) {
    throw new Error('The temporary reviewer passcode is invalid.');
  }
  var expectedLoginUrl = (
    properties.getProperty('REVIEWER_PORTAL_URL') ||
    'https://pbast10-admin.drygchung.chatgpt.site/reviewer/login'
  ).replace(/\/$/, '');
  if (loginUrl.replace(/\/$/, '') !== expectedLoginUrl) {
    throw new Error('The reviewer login URL is invalid.');
  }
  if (deadline.length > 80) {
    throw new Error('The review deadline is invalid.');
  }

  var deadlineText = deadline
    ? Utilities.formatDate(
        new Date(deadline),
        'Asia/Seoul',
        'MMMM d, yyyy, HH:mm'
      ) + ' KST'
    : 'Shown in the reviewer portal';
  var subject = '[PBAST10] Abstract review login details';
  var text = [
    'Dear ' + name + ',',
    '',
    'Thank you for serving as a reviewer for PBAST10.',
    '',
    'Reviewer portal: ' + loginUrl,
    'Login email: ' + email,
    'Temporary passcode: ' + temporaryPasscode,
    'Review deadline: ' + deadlineText,
    '',
    'For security, the portal will ask you to replace the temporary passcode after your first sign-in. Please do not forward this email.',
    '',
    'PBAST10 Secretariat'
  ].join('\n');
  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;color:#172535;line-height:1.6">' +
    '<div style="border-top:6px solid #003876;padding:28px;border:1px solid #dfe6ec">' +
    '<p>Dear ' + adminEscapeHtml_(name) + ',</p>' +
    '<p>Thank you for serving as a reviewer for PBAST10. Your individual login details are below.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:22px 0;background:#f4f7f9">' +
    adminInviteRow_('Reviewer portal', '<a href="' + adminEscapeHtml_(loginUrl) + '">' + adminEscapeHtml_(loginUrl) + '</a>') +
    adminInviteRow_('Login email', adminEscapeHtml_(email)) +
    adminInviteRow_('Temporary passcode', '<span style="font-family:monospace;font-size:16px;letter-spacing:.04em">' + adminEscapeHtml_(temporaryPasscode) + '</span>') +
    adminInviteRow_('Review deadline', adminEscapeHtml_(deadlineText)) +
    '</table>' +
    '<p>For security, the portal will ask you to replace the temporary passcode after your first sign-in. Please do not forward this email.</p>' +
    '<p style="margin-top:28px">PBAST10 Secretariat</p>' +
    '</div></div>';

  sendTransactionalEmail_({
    to: email,
    toName: name,
    subject: subject,
    textContent: text,
    htmlContent: html,
    senderName: 'PBAST10 Secretariat',
    replyTo:
      properties.getProperty('REPLY_TO_EMAIL') ||
      'secretariat@pbast10.org'
  }, properties);
  return jsonResponse_({ ok: true, sentAt: new Date().toISOString() });
}

function adminInviteRow_(label, value) {
  return (
    '<tr><td style="padding:10px 14px;font-weight:bold">' +
    adminEscapeHtml_(label) +
    '</td><td style="padding:10px 14px">' +
    value +
    '</td></tr>'
  );
}

function adminEscapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

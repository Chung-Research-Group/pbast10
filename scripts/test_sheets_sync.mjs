#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const env = new Map([
  ["GOOGLE_SHEETS_WEBHOOK_URL", "https://example.test/exec"],
  ["SHEETS_SYNC_SECRET", "test-secret"],
]);
globalThis.Netlify = { env: { get: (key) => env.get(key) } };

let forwarded = null;
let pdfPrefix = "%PDF-1.7\n";
globalThis.fetch = async (url, options) => {
  if (options?.headers?.range) {
    return new Response(pdfPrefix, { status: 206 });
  }
  forwarded = { url, options, body: JSON.parse(options.body) };
  return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
};

const netlifyHandler = (await import("../netlify/functions/sync-abstracts-to-sheets.mjs")).default;
const sampleData = {
  "form-name": "abstract-submission",
  "submission-id": "test-submission-1",
  "first-name": "Ada",
  "last-name": "Lovelace",
  email: "ada@example.org",
  affiliation: "Example University",
  country: "United Kingdom",
  "presentation-preference": "Oral",
  "primary-topic": "Molecular simulation and machine learning",
  "abstract-title": "A reproducible adsorption study",
  "abstract-file": [{
    filename: "abstract.pdf",
    type: "file",
    size: 1024,
    url: "https://example.test/abstract.pdf",
  }],
  consent: "yes",
};

await netlifyHandler.formSubmitted({ data: sampleData });
assert.equal(forwarded.url, "https://example.test/exec");
assert.equal(forwarded.body.action, "create");
assert.equal(forwarded.body.submissionId, "test-submission-1");

forwarded = null;
const sampleWithoutFormName = { ...sampleData };
delete sampleWithoutFormName["form-name"];
await netlifyHandler.formSubmitted({ data: sampleWithoutFormName });
assert.equal(forwarded.body.action, "create", "a submission must be inferred when Netlify omits form-name");

const revisionData = {
  ...sampleData,
  "form-name": "abstract-revision",
  "revision-id": "revision-event-1",
  "edit-token": "a".repeat(64),
  "abstract-file": JSON.stringify([{
    filename: "revised.pdf",
    size: 2048,
    url: "https://example.test/revised.pdf",
  }]),
};
await netlifyHandler.formSubmitted({ data: revisionData });
assert.equal(forwarded.body.action, "revise");
assert.equal(forwarded.body.eventId, "revision-event-1");

forwarded = null;
const revisionWithoutFormName = { ...revisionData };
delete revisionWithoutFormName["form-name"];
await netlifyHandler.formSubmitted({ data: revisionWithoutFormName });
assert.equal(forwarded.body.action, "revise", "a revision must be inferred when Netlify omits form-name");

forwarded = null;
await netlifyHandler.formSubmitted({ data: { "form-name": "another-form" } });
assert.equal(forwarded, null, "unrelated forms must not be forwarded");

await assert.rejects(
  netlifyHandler.formSubmitted({
    data: { ...sampleData, "abstract-file": [{ filename: "malware.docm", size: 1024, url: "https://example.test/malware.docm" }] },
  }),
  /Only PDF/,
  "non-PDF uploads must be rejected before forwarding",
);
pdfPrefix = "not a PDF";
await assert.rejects(
  netlifyHandler.formSubmitted({ data: sampleData }),
  /valid PDF header/,
  "files with a PDF extension but no PDF signature must be rejected",
);
pdfPrefix = "%PDF-1.7\n";

const revisionApiModule = await import("../netlify/functions/abstract-revision-api.mjs");
const revisionApi = revisionApiModule.default;
assert.equal(revisionApiModule.config.rateLimit.windowLimit, 10);
assert.deepEqual(revisionApiModule.config.rateLimit.aggregateBy, ["ip", "domain"]);
const invalidApiResponse = await revisionApi(new Request("https://example.test/.netlify/functions/abstract-revision-api", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "invalid" }),
}));
assert.equal(invalidApiResponse.status, 400);

forwarded = null;
const validApiResponse = await revisionApi(new Request("https://example.test/.netlify/functions/abstract-revision-api", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ token: "a".repeat(64) }),
}));
assert.equal(validApiResponse.status, 200);
assert.equal(forwarded.body.action, "get");
assert.equal(forwarded.body.secret, "test-secret");

forwarded = null;
const withdrawalApiResponse = await revisionApi(new Request("https://example.test/.netlify/functions/abstract-revision-api", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "withdraw", token: "a".repeat(64) }),
}));
assert.equal(withdrawalApiResponse.status, 200);
assert.equal(forwarded.body.action, "withdraw");
assert.equal(forwarded.body.secret, "test-secret");

const adminRelayModule = await import("../netlify/functions/admin-abstract-sync.mjs");
const adminToken = "a".repeat(64);
const rotatedAdminToken = "b".repeat(64);
env.set(
  "PBAST10_ADMIN_TOKEN_SHA256",
  crypto.createHash("sha256").update(rotatedAdminToken).digest("hex"),
);
const adminRelay = adminRelayModule.makeHandler({
  tokenSha256: crypto.createHash("sha256").update(adminToken).digest("hex"),
});
const unauthorizedAdminResponse = await adminRelay(new Request("https://example.test/.netlify/functions/admin-abstract-sync", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "list" }),
}));
assert.equal(unauthorizedAdminResponse.status, 401);

forwarded = null;
const authorizedAdminResponse = await adminRelay(new Request("https://example.test/.netlify/functions/admin-abstract-sync", {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ action: "list" }),
}));
assert.equal(authorizedAdminResponse.status, 200);
assert.equal(forwarded.body.action, "admin-list");
assert.equal(forwarded.body.secret, "test-secret");

forwarded = null;
const rotatedAdminResponse = await adminRelay(new Request("https://example.test/.netlify/functions/admin-abstract-sync", {
  method: "POST",
  headers: {
    authorization: `Bearer ${rotatedAdminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ action: "list" }),
}));
assert.equal(rotatedAdminResponse.status, 200);
assert.equal(forwarded.body.action, "admin-list");
assert.equal(forwarded.body.secret, "test-secret");

forwarded = null;
const acceptanceRelayResponse = await adminRelay(new Request("https://example.test/.netlify/functions/admin-abstract-sync", {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    action: "acceptance-email",
    submissionId: "test-submission-1",
    expectedFingerprint: "b".repeat(64),
  }),
}));
assert.equal(acceptanceRelayResponse.status, 200);
assert.equal(forwarded.body.action, "admin-acceptance-email");
assert.equal(forwarded.body.submissionId, "test-submission-1");
assert.equal(forwarded.body.expectedFingerprint, "b".repeat(64));

forwarded = null;
const reviewerRelayResponse = await adminRelay(new Request("https://example.test/.netlify/functions/admin-abstract-sync", {
  method: "POST",
  headers: {
    authorization: `Bearer ${adminToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    action: "reviewer-invite",
    email: "reviewer@example.org",
    name: "Example Reviewer",
    temporaryPasscode: "Abcd-Efgh-2345",
    loginUrl: "https://admin.pbast10.org/reviewer/login",
    deadline: "2027-02-28T14:59:00.000Z",
  }),
}));
assert.equal(reviewerRelayResponse.status, 200);
assert.equal(forwarded.body.action, "admin-reviewer-invite");
assert.equal(forwarded.body.email, "reviewer@example.org");
assert.equal(forwarded.body.name, "Example Reviewer");
assert.equal(forwarded.body.temporaryPasscode, "Abcd-Efgh-2345");
assert.equal(forwarded.body.loginUrl, "https://admin.pbast10.org/reviewer/login");
assert.equal(forwarded.body.deadline, "2027-02-28T14:59:00.000Z");

class MockRange {
  constructor(sheet, startRow, startColumn, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, startRow, startColumn, rowCount, columnCount });
  }
  getRow() { return this.startRow; }
  getValue() { return this.sheet.valueAt(this.startRow, this.startColumn); }
  setValue(value) { this.sheet.write(this.startRow, this.startColumn, [[value]]); return this; }
  getValues() {
    return Array.from({ length: this.rowCount }, (_, r) =>
      Array.from({ length: this.columnCount }, (_, c) => this.sheet.valueAt(this.startRow + r, this.startColumn + c))
    );
  }
  setValues(values) { this.sheet.write(this.startRow, this.startColumn, values); return this; }
  breakApart() { return this; }
  clearContent() { return this; }
  merge() { return this; }
  mergeAcross() { return this; }
  setBackground() { return this; }
  setFontSize() { return this; }
  setFontWeight() { return this; }
  setVerticalAlignment() { return this; }
  setHorizontalAlignment() { return this; }
  setWrap() { return this; }
  setBorder() { return this; }
  setNumberFormat() { return this; }
  setDataValidation(validation) { this.sheet.validations.push({ range: this, validation }); return this; }
  createFilter() {
    this.sheet.filter = { remove: () => { this.sheet.filter = null; } };
    return this.sheet.filter;
  }
  getColumn() { return this.startColumn; }
  createTextFinder(needle) {
    const range = this;
    return {
      matchEntireCell() {
        return {
          findNext() {
            for (let r = 0; r < range.rowCount; r += 1) {
              if (String(range.sheet.valueAt(range.startRow + r, range.startColumn)) === String(needle)) {
                return new MockRange(range.sheet, range.startRow + r, range.startColumn);
              }
            }
            return null;
          },
        };
      },
    };
  }
}

class MockSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows;
    this.maxRows = Math.max(200, rows.length);
    this.validations = [];
    this.conditionalRules = [];
    this.filter = null;
    this.hidden = false;
  }
  setName(name) { this.name = name; return this; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() { return Math.max(26, ...this.rows.map((row) => row.length)); }
  getMaxRows() { return this.maxRows; }
  insertColumnsAfter() {}
  insertRowsAfter(_after, count) { this.maxRows += count; }
  getRange(...args) { return new MockRange(this, ...args); }
  appendRow(row) { this.rows.push([...row]); }
  setFrozenRows() {}
  setFrozenColumns() {}
  setColumnWidth() {}
  setColumnWidths() {}
  setRowHeight() {}
  setTabColor() {}
  autoResizeColumns() {}
  getFilter() { return this.filter; }
  getConditionalFormatRules() { return this.conditionalRules; }
  setConditionalFormatRules(rules) { this.conditionalRules = rules; }
  isSheetHidden() { return this.hidden; }
  hideSheet() { this.hidden = true; }
  valueAt(row, column) { return this.rows[row - 1]?.[column - 1] ?? ""; }
  write(row, column, values) {
    values.forEach((sourceRow, r) => {
      const targetRow = row + r - 1;
      while (this.rows.length <= targetRow) this.rows.push([]);
      sourceRow.forEach((value, c) => { this.rows[targetRow][column + c - 1] = value; });
    });
  }
}

const tracker = new MockSheet("Abstract Tracker", [[
  "Submission ID", "Submitted At", "Last Name", "First Name", "Full Name",
  "Email", "Institution / Affiliation", "Country / Region",
  "Presentation Preference", "Primary Topic", "Abstract Title", "Co-authors",
  "Abstract File URL", "Consent", "Intake Status", "Reviewer 1",
  "Reviewer 1 Decision", "Reviewer 2", "Reviewer 2 Decision", "Final Decision",
  "Final Presentation Type", "Notification Status", "Notes",
]]);
const sheets = new Map([[tracker.name, tracker]]);
const spreadsheet = {
  getSheetByName: (name) => sheets.get(name) || null,
  insertSheet: (name) => { const sheet = new MockSheet(name); sheets.set(name, sheet); return sheet; },
  getSheets: () => [...sheets.values()],
  getId: () => "new-workspace-sheet-id",
  getUrl: () => "https://docs.google.com/spreadsheets/d/new-workspace-sheet-id/edit",
  getName: () => "PBAST10 Abstract Submission Tracker",
};
const sentEmails = [];
const brevoRequests = [];
let brevoStatus = 201;
let brevoResponseBody = JSON.stringify({ messageId: "brevo-test-message" });
let uuidCounter = 0;

function textOutput(body) {
  return { body, setMimeType() { return this; } };
}

const properties = new Map();
const context = {
  console,
  Logger: { log() {} },
  Date,
  JSON,
  String,
  Math,
  isNaN,
  encodeURIComponent,
  LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperty: (key, value) => { properties.set(key, String(value)); },
    }),
  },
  SpreadsheetApp: {
    create: () => spreadsheet,
    openById: () => spreadsheet,
    newDataValidation: () => ({
      setAllowInvalid() { return this; },
      requireValueInRange(range) { this.range = range; return this; },
      build() { return { range: this.range }; },
    }),
    newConditionalFormatRule: () => ({
      whenTextEqualTo(value) { this.value = value; return this; },
      setBackground(color) { this.color = color; return this; },
      setRanges(ranges) { this.ranges = ranges; return this; },
      build() {
        const ranges = this.ranges;
        return { getRanges: () => ranges, value: this.value, color: this.color };
      },
    }),
  },
  Utilities: {
    getUuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
    computeDigest: (_, value) => [...crypto.createHash("sha256").update(value).digest()].map((n) => n > 127 ? n - 256 : n),
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    formatDate: (date) => date.toISOString(),
  },
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail: (message) => sentEmails.push(message),
  },
  UrlFetchApp: {
    fetch: (url, options) => {
      brevoRequests.push({
        url,
        options,
        body: JSON.parse(options.payload),
      });
      return {
        getResponseCode: () => brevoStatus,
        getContentText: () => brevoResponseBody,
      };
    },
  },
  ContentService: { createTextOutput: textOutput, MimeType: { JSON: "application/json" } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"), context);
vm.runInContext(fs.readFileSync(new URL("../google-apps-script/AdminSync.gs", import.meta.url), "utf8"), context);

function callAppsScript(payload) {
  return JSON.parse(context.doPost({
    postData: { contents: JSON.stringify({ secret: properties.get("SYNC_SECRET"), ...payload }) },
  }).body);
}

const setup = context.initializePBAST10();
assert.equal(setup.spreadsheetId, "new-workspace-sheet-id");
assert.equal(setup.replyTo, "secretariat@pbast10.org");
assert.equal(properties.get("SPREADSHEET_ID"), "new-workspace-sheet-id");
assert.match(properties.get("SYNC_SECRET"), /^[a-f0-9]{96}$/);
assert.equal(properties.get("EMAIL_PROVIDER"), "brevo");
assert.equal(properties.get("BREVO_SENDER_EMAIL"), "secretariat@pbast10.org");
assert.equal(properties.get("BREVO_SENDER_NAME"), "PBAST10 Organizing Committee");
assert.equal(properties.get("BREVO_TEST_RECIPIENT"), "secretariat@pbast10.org");
assert.deepEqual(tracker.rows[0], Array.from(context.TRACKER_HEADERS));
const lists = sheets.get("Lists");
assert.ok(lists, "initializer must create the validation Lists sheet");
assert.equal(lists.hidden, true, "validation Lists sheet must be hidden");
assert.equal(lists.rows[2][2], "Accept");
assert.equal(tracker.validations.length, 6, "tracker must receive six committee workflow dropdowns");
assert.equal(tracker.conditionalRules.length, 4, "tracker must receive four workflow status color rules");
const summary = sheets.get("Summary");
assert.ok(summary, "initializer must create the Summary sheet");
assert.equal(summary.rows[0][0], "PBAST10 Abstract Submission Summary");
assert.equal(summary.rows[3][1], "=COUNTA('Abstract Tracker'!A2:A1000)");
assert.equal(summary.rows[4][1], '=COUNTIF(\'Abstract Tracker\'!O2:O1000,"New")');
assert.equal(summary.rows[5][1], '=COUNTIF(\'Abstract Tracker\'!T2:T1000,"Accept")');
assert.equal(summary.rows[6][1], '=COUNTIF(\'Abstract Tracker\'!U2:U1000,"Oral")');
assert.equal(summary.rows[7][1], '=COUNTIF(\'Abstract Tracker\'!U2:U1000,"Poster")');
assert.equal(summary.rows[8][1], '=COUNTIF(\'Abstract Tracker\'!T2:T1000,"Reject")');
assert.equal(summary.rows[9][1], '=COUNTIF(\'Abstract Tracker\'!V2:V1000,"Sent")+COUNTIF(\'Abstract Tracker\'!V2:V1000,"Confirmed")');
const originalSecret = properties.get("SYNC_SECRET");
context.initializePBAST10();
assert.equal(properties.get("SYNC_SECRET"), originalSecret, "rerunning setup must not rotate the shared secret");
properties.set("EMAIL_PROVIDER", "mailapp");

const createResult = callAppsScript({
  action: "create",
  submissionId: "test-submission-1",
  submittedAt: "2026-07-17T01:02:03.000Z",
  data: sampleData,
});
assert.equal(createResult.ok, true);
assert.equal(tracker.rows.length, 2);
assert.equal(tracker.rows[1].length, 29);
assert.equal(tracker.rows[1][4], "Lovelace, Ada");
assert.equal(tracker.rows[1][11], "", "new submissions no longer collect a separate co-author field");
assert.equal(tracker.rows[1][21], "Not sent", "decision notification status must remain untouched");
assert.equal(tracker.rows[1][24], 0);
assert.equal(tracker.rows[1][27], "Confirmation sent");
assert.equal(sentEmails.length, 1);
assert.equal(sentEmails[0].to, "ada@example.org");
assert.equal(sentEmails[0].subject, "[PBAST10] Abstract submission confirmed — test-submission-1");
assert.equal(sentEmails[0].replyTo, "secretariat@pbast10.org");
assert.match(sentEmails[0].htmlBody, /Review, Revise, or Withdraw Your Abstract/);
assert.match(sentEmails[0].htmlBody, /background:#003876/);
assert.equal((sentEmails[0].htmlBody.match(/href=/g) || []).length, 1, "confirmation HTML must contain exactly one link");

const token = sentEmails[0].body.match(/#token=([a-f0-9]{64})/i)?.[1];
assert.ok(token, "confirmation email must contain a 64-character token");
assert.ok(sentEmails[0].htmlBody.includes(`#token=${token}`), "plain-text and HTML bodies must contain the same private revision token");

const adminList = JSON.parse(context.adminList_(tracker).body);
assert.equal(adminList.ok, true);
assert.equal(adminList.rows.length, 1);
assert.equal(adminList.rows[0].notificationStatus, "Not Sent");
assert.match(adminList.rows[0].sourceFingerprint, /^[a-f0-9]{64}$/);
assert.equal("tokenHash" in adminList.rows[0], false, "edit-token hashes must not leave Apps Script");
assert.equal("consent" in adminList.rows[0], false, "consent values must not leave Apps Script");

const initialAdminFingerprint = adminList.rows[0].sourceFingerprint;
const adminUpdate = JSON.parse(context.adminUpdate_(tracker, {
  submissionId: "test-submission-1",
  expectedFingerprint: initialAdminFingerprint,
  changes: {
    intakeStatus: "Checked",
    reviewer1: "=HYPERLINK(\"bad\")",
    reviewer1Decision: "Accept Oral",
    reviewer2: "Reviewer Two",
    reviewer2Decision: "Accept Oral",
    finalDecision: "Accept",
    finalPresentationType: "Oral",
    notificationStatus: "Not Sent",
    notes: "+private note",
  },
}).body);
assert.equal(adminUpdate.ok, true);
assert.equal(adminUpdate.row.intakeStatus, "Checked");
assert.notEqual(adminUpdate.row.sourceFingerprint, initialAdminFingerprint);
assert.equal(tracker.rows[1][15], "'=HYPERLINK(\"bad\")", "reviewer formulas must be escaped");
assert.equal(tracker.rows[1][22], "'+private note", "note formulas must be escaped");

const staleAdminUpdate = JSON.parse(context.adminUpdate_(tracker, {
  submissionId: "test-submission-1",
  expectedFingerprint: initialAdminFingerprint,
  changes: {
    intakeStatus: "New",
    reviewer1: "",
    reviewer1Decision: "",
    reviewer2: "",
    reviewer2Decision: "",
    finalDecision: "Pending",
    finalPresentationType: "Pending",
    notificationStatus: "Not Sent",
    notes: "",
  },
}).body);
assert.equal(staleAdminUpdate.ok, false);
assert.equal(staleAdminUpdate.code, "SYNC_CONFLICT");
const lookup = callAppsScript({ action: "get", token });
assert.equal(lookup.ok, true);
assert.equal(lookup.submission.abstractTitle, sampleData["abstract-title"]);
assert.equal(lookup.submission.email, "ada@example.org");
assert.equal("tokenHash" in lookup.submission, false, "private metadata must not be returned");

tracker.rows[1][11] = "Lovelace, Ada; Babbage, Charles";
const revisedData = {
  ...sampleData,
  email: "ada.new@example.org",
  "abstract-title": "A revised adsorption study",
  "abstract-file": JSON.stringify([{
    filename: "revised.pdf",
    size: 2048,
    url: "https://example.test/revised.pdf",
  }]),
  "edit-token": token,
};
const revisionResult = callAppsScript({
  action: "revise",
  eventId: "revision-event-1",
  submittedAt: "2026-07-18T01:02:03.000Z",
  data: revisedData,
});
assert.equal(revisionResult.ok, true);
assert.equal(revisionResult.revisionCount, 1);
assert.equal(tracker.rows[1][10], "A revised adsorption study");
assert.equal(tracker.rows[1][11], "Lovelace, Ada; Babbage, Charles", "revision without co-authors must preserve the stored legacy value");
assert.equal(tracker.rows[1][12], "https://example.test/revised.pdf");
assert.equal(tracker.rows[1][24], 1);
assert.equal(tracker.rows[1][26], "revision-event-1");
assert.equal(tracker.rows[1][27], "Revision confirmation sent");
assert.equal(sentEmails.length, 3, "revision confirmation and old-address alert must be sent");
assert.equal(sentEmails[1].to, "ada.new@example.org");
assert.equal(sentEmails[1].subject, "[PBAST10] Abstract revision confirmed — test-submission-1");
assert.equal(sentEmails[2].to, "ada@example.org");
assert.equal(sentEmails[2].subject, "PBAST10 Submission Email Address Changed");
assert.equal(callAppsScript({ action: "get", token }).ok, false, "old token must be invalidated after revision");

const revisedToken = sentEmails[1].body.match(/#token=([a-f0-9]{64})/i)?.[1];
assert.ok(revisedToken, "revision confirmation must issue a new private token");
const withdrawal = callAppsScript({ action: "withdraw", token: revisedToken });
assert.equal(withdrawal.ok, true);
assert.equal(withdrawal.duplicate, false);
assert.equal(withdrawal.emailSent, true);
assert.equal(tracker.rows[1][14], "Withdrawn");
assert.equal(tracker.rows[1][19], "Withdrawn");
assert.equal(tracker.rows[1][20], "None");
assert.match(tracker.rows[1][22], /Withdrawn by submitter/);
assert.equal(sentEmails.length, 4, "withdrawal must send one confirmation");
assert.equal(sentEmails[3].subject, "[PBAST10] Abstract withdrawn — test-submission-1");

const repeatedWithdrawal = callAppsScript({ action: "withdraw", token: revisedToken });
assert.equal(repeatedWithdrawal.ok, true);
assert.equal(repeatedWithdrawal.duplicate, true);
assert.equal(sentEmails.length, 4, "repeated withdrawal must not resend confirmation");

const revisionAfterWithdrawal = callAppsScript({
  action: "revise",
  eventId: "revision-event-after-withdrawal",
  data: { ...revisedData, "edit-token": revisedToken },
});
assert.equal(revisionAfterWithdrawal.ok, false);
assert.equal(revisionAfterWithdrawal.code, "SUBMISSION_WITHDRAWN");

const history = sheets.get("Revision History");
assert.equal(history.rows.length, 4, "history must contain a header, original, revision, and withdrawal");
assert.equal(history.rows[1][2], 0);
assert.equal(history.rows[2][2], 1);
assert.equal(history.rows[2][1], "revision-event-1", "history must retain the Netlify revision event ID");
assert.equal(history.rows[2][14], "Lovelace, Ada; Babbage, Charles", "revision history must retain the stored legacy co-author value");
assert.equal(history.rows[3][4], "Withdrawal");

const duplicate = callAppsScript({
  action: "revise",
  eventId: "revision-event-1",
  data: revisedData,
});
assert.equal(duplicate.ok, true);
assert.equal(duplicate.duplicate, true);
assert.equal(history.rows.length, 4, "retry must not append another history row");

properties.set("EMAIL_PROVIDER", "brevo");
assert.throws(
  () => context.sendTransactionalEmail_({
    to: "missing-key@example.org",
    subject: "Missing key check",
    textContent: "Test",
    htmlContent: "<p>Test</p>",
    replyTo: "secretariat@pbast10.org",
  }, context.PropertiesService.getScriptProperties()),
  /BREVO_API_KEY is missing/,
  "Brevo must fail closed rather than silently falling back to MailApp",
);
properties.set("BREVO_API_KEY", "test-brevo-key");
properties.set("BREVO_SENDER_EMAIL", "secretariat@pbast10.org");
properties.set("BREVO_SENDER_NAME", "PBAST10 Secretariat");
properties.set("REVIEWER_PORTAL_URL", "https://admin.pbast10.org/reviewer/login");

const brevoSubmission = callAppsScript({
  action: "create",
  submissionId: "brevo-submission-1",
  submittedAt: "2026-07-24T01:02:03.000Z",
  data: {
    ...sampleData,
    email: "brevo.recipient@example.org",
    "abstract-title": "Transactional delivery through Brevo",
  },
});
assert.equal(brevoSubmission.ok, true);
assert.equal(brevoRequests.length, 1, "submission confirmation must use Brevo when configured");
assert.equal(brevoRequests[0].url, "https://api.brevo.com/v3/smtp/email");
assert.equal(brevoRequests[0].options.headers["api-key"], "test-brevo-key");
assert.equal(brevoRequests[0].body.to[0].email, "brevo.recipient@example.org");
assert.equal(brevoRequests[0].body.replyTo.email, "secretariat@pbast10.org");
assert.equal(brevoRequests[0].body.subject, "[PBAST10] Abstract submission confirmed — brevo-submission-1");

const acceptedRow = tracker.rows[2];
acceptedRow[14] = "Checked";
acceptedRow[19] = "Accept";
acceptedRow[20] = "Oral";
acceptedRow[21] = "Not sent";
const acceptance = callAppsScript({
  action: "admin-acceptance-email",
  submissionId: "brevo-submission-1",
  expectedFingerprint: context.adminFingerprint_(acceptedRow),
});
assert.equal(acceptance.ok, true);
assert.equal(acceptance.delivered, true);
assert.equal(acceptedRow[21], "Sent");
assert.equal(brevoRequests.length, 2, "acceptance notification must use the same Brevo path");
assert.equal(brevoRequests[1].body.subject, "[PBAST10] Abstract accepted — brevo-submission-1");

const reviewerInvite = callAppsScript({
  action: "admin-reviewer-invite",
  email: "reviewer@example.org",
  name: "Example Reviewer",
  temporaryPasscode: "Abcd-Efgh-2345",
  loginUrl: "https://admin.pbast10.org/reviewer/login",
  deadline: "2027-02-28T14:59:00.000Z",
});
assert.equal(reviewerInvite.ok, true);
assert.equal(brevoRequests.length, 3, "reviewer invitation must use the same Brevo path");
assert.equal(brevoRequests[2].body.to[0].email, "reviewer@example.org");
assert.equal(brevoRequests[2].body.subject, "[PBAST10] Abstract review login details");

properties.set("BREVO_TEST_RECIPIENT", "delivery.test@example.org");
const testEmailResult = context.testBrevoTransactionalDelivery();
assert.equal(testEmailResult.ok, true);
assert.equal(testEmailResult.provider, "brevo");
assert.equal(testEmailResult.recipient, "delivery.test@example.org");
assert.equal(testEmailResult.messageId, "brevo-test-message");
assert.match(testEmailResult.sentAt, /^\d{4}-\d{2}-\d{2}T/);
assert.equal(brevoRequests.length, 4, "the diagnostic message must use the shared Brevo path");
assert.equal(brevoRequests[3].body.to[0].email, "delivery.test@example.org");
assert.equal(brevoRequests[3].body.subject, "[PBAST10] Brevo transactional email test");
assert.match(brevoRequests[3].body.textContent, /abstract confirmations/);
assert.match(brevoRequests[3].body.htmlContent, /acceptance notifications/);
properties.set("BREVO_TEST_RECIPIENT", "invalid");
assert.throws(
  () => context.sendTestEmail(),
  /BREVO_TEST_RECIPIENT/i,
  "the diagnostic function must reject an invalid recipient before calling Brevo",
);
assert.equal(brevoRequests.length, 4, "an invalid diagnostic recipient must not call Brevo");
properties.set("BREVO_TEST_RECIPIENT", "delivery.test@example.org");

brevoStatus = 400;
brevoResponseBody = JSON.stringify({ message: "sender not verified" });
const originalConsoleError = context.console.error;
context.console.error = () => {};
let failedBrevoSubmission;
try {
  failedBrevoSubmission = callAppsScript({
    action: "create",
    submissionId: "brevo-failure-1",
    submittedAt: "2026-07-24T02:03:04.000Z",
    data: {
      ...sampleData,
      email: "failure@example.org",
      "abstract-title": "Provider error visibility",
    },
  });
} finally {
  context.console.error = originalConsoleError;
}
assert.equal(failedBrevoSubmission.ok, false);
assert.match(failedBrevoSubmission.error, /Brevo rejected.*HTTP 400.*sender not verified/);
assert.equal(tracker.rows[3][27], "Confirmation failed");
assert.match(tracker.rows[3][22], /Brevo rejected.*sender not verified/);

console.log("Abstract confirmation and revision tests passed.");

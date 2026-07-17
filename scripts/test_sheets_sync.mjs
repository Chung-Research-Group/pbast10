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
globalThis.fetch = async (url, options) => {
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
  "co-authors": "Babbage, Charles — Example University",
  "abstract-file": "https://example.test/abstract.pdf",
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
  "abstract-file": "https://example.test/revised.pdf",
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

const revisionApi = (await import("../netlify/functions/abstract-revision-api.mjs")).default;
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
  constructor(name, rows = []) { this.name = name; this.rows = rows; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() { return Math.max(26, ...this.rows.map((row) => row.length)); }
  insertColumnsAfter() {}
  getRange(...args) { return new MockRange(this, ...args); }
  appendRow(row) { this.rows.push([...row]); }
  setFrozenRows() {}
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
};
const sentEmails = [];
let uuidCounter = 0;

function textOutput(body) {
  return { body, setMimeType() { return this; } };
}

const properties = new Map([
  ["SYNC_SECRET", "test-secret"],
  ["SPREADSHEET_ID", "sheet-id"],
  ["REVISION_DEADLINE", "2099-11-30T23:59:59+09:00"],
]);
const context = {
  console,
  Date,
  JSON,
  String,
  Math,
  isNaN,
  encodeURIComponent,
  LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || null }) },
  SpreadsheetApp: { openById: () => spreadsheet },
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
  ContentService: { createTextOutput: textOutput, MimeType: { JSON: "application/json" } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"), context);

function callAppsScript(payload) {
  return JSON.parse(context.doPost({ postData: { contents: JSON.stringify({ secret: "test-secret", ...payload }) } }).body);
}

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
assert.equal(tracker.rows[1][21], "Not sent", "decision notification status must remain untouched");
assert.equal(tracker.rows[1][24], 0);
assert.equal(tracker.rows[1][27], "Confirmation sent");
assert.equal(sentEmails.length, 1);

const token = sentEmails[0].body.match(/token=([a-f0-9]{64})/i)?.[1];
assert.ok(token, "confirmation email must contain a 64-character token");
const lookup = callAppsScript({ action: "get", token });
assert.equal(lookup.ok, true);
assert.equal(lookup.submission.abstractTitle, sampleData["abstract-title"]);
assert.equal(lookup.submission.email, "ada@example.org");
assert.equal("tokenHash" in lookup.submission, false, "private metadata must not be returned");

const revisedData = {
  ...sampleData,
  email: "ada.new@example.org",
  "abstract-title": "A revised adsorption study",
  "abstract-file": "https://example.test/revised.pdf",
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
assert.equal(tracker.rows[1][12], "https://example.test/revised.pdf");
assert.equal(tracker.rows[1][24], 1);
assert.equal(tracker.rows[1][26], "revision-event-1");
assert.equal(tracker.rows[1][27], "Revision confirmation sent");
assert.equal(sentEmails.length, 3, "revision confirmation and old-address alert must be sent");
assert.equal(callAppsScript({ action: "get", token }).ok, false, "old token must be invalidated after revision");

const history = sheets.get("Revision History");
assert.equal(history.rows.length, 3, "history must contain a header, original, and revision");
assert.equal(history.rows[1][2], 0);
assert.equal(history.rows[2][2], 1);
assert.equal(history.rows[2][1], "revision-event-1", "history must retain the Netlify revision event ID");

const duplicate = callAppsScript({
  action: "revise",
  eventId: "revision-event-1",
  data: revisedData,
});
assert.equal(duplicate.ok, true);
assert.equal(duplicate.duplicate, true);
assert.equal(history.rows.length, 3, "retry must not append another history row");

console.log("Abstract confirmation and revision tests passed.");

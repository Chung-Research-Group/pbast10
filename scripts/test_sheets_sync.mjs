#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Test the Netlify event function without making network requests.
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
  "co-authors": "Charles Babbage, Example University",
  "abstract-file": "https://example.test/abstract.pdf",
  consent: "yes",
};

await netlifyHandler.formSubmitted({ data: sampleData });
assert.equal(forwarded.url, "https://example.test/exec");
assert.equal(forwarded.body.secret, "test-secret");
assert.equal(forwarded.body.submissionId, "test-submission-1");
assert.deepEqual(forwarded.body.data, sampleData);

forwarded = null;
await netlifyHandler.formSubmitted({ data: { "form-name": "another-form" } });
assert.equal(forwarded, null, "unrelated forms must not be forwarded");

// Test the Apps Script receiver with mocked Google services.
const rows = [[
  "Submission ID", "Submitted At", "Last Name", "First Name", "Full Name",
  "Email", "Institution / Affiliation", "Country / Region",
  "Presentation Preference", "Primary Topic", "Abstract Title", "Co-authors",
  "Abstract File URL", "Consent", "Intake Status", "Reviewer 1",
  "Reviewer 1 Decision", "Reviewer 2", "Reviewer 2 Decision", "Final Decision",
  "Final Presentation Type", "Notification Status", "Notes",
]];

const sheet = {
  getLastRow: () => rows.length,
  appendRow: (row) => rows.push(row),
  getRange: (startRow, startColumn, rowCount, columnCount) => ({
    createTextFinder: (needle) => ({
      matchEntireCell: () => ({
        findNext: () => rows.slice(startRow - 1, startRow - 1 + rowCount)
          .some((row) => row[startColumn - 1] === needle) ? {} : null,
      }),
    }),
  }),
};

function textOutput(body) {
  return { body, setMimeType() { return this; } };
}

const context = {
  console,
  Date,
  JSON,
  String,
  LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => key === "SYNC_SECRET" ? "test-secret" : "sheet-id" }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (name) => name === "Abstract Tracker" ? sheet : null }) },
  Utilities: { getUuid: () => "generated-id" },
  ContentService: { createTextOutput: textOutput, MimeType: { JSON: "application/json" } },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8"), context);

const event = {
  postData: { contents: JSON.stringify({
    secret: "test-secret",
    submissionId: "test-submission-1",
    submittedAt: "2026-07-17T01:02:03.000Z",
    data: sampleData,
  }) },
};

const firstResult = JSON.parse(context.doPost(event).body);
assert.equal(firstResult.ok, true);
assert.equal(firstResult.duplicate, false);
assert.equal(rows.length, 2);
assert.equal(rows[1].length, 23);
assert.equal(rows[1][0], "test-submission-1");
assert.equal(rows[1][2], "Lovelace");
assert.equal(rows[1][3], "Ada");
assert.equal(rows[1][4], "Lovelace, Ada");
assert.equal(rows[1][12], "https://example.test/abstract.pdf");
assert.equal(rows[1][14], "New");
assert.equal(rows[1][19], "Pending");
assert.equal(rows[1][21], "Not Sent");

const duplicateResult = JSON.parse(context.doPost(event).body);
assert.equal(duplicateResult.ok, true);
assert.equal(duplicateResult.duplicate, true);
assert.equal(rows.length, 2, "duplicate delivery must not append another row");

console.log("Google Sheets sync tests passed.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  extractAuthorMetadataFromLines,
  extractPdfAuthorMetadata,
} from "../netlify/functions/lib/pdf-author-extractor.mjs";

const standard = extractAuthorMetadataFromLines([
  "PBAST10",
  "A Sample Abstract",
  "Lovelace, Ada¹*; Babbage, Charles²; Hopper, Grace¹",
  "¹ Department of Computing, Example University, Seoul, Republic of Korea",
  "² Institute of Engines, Example Academy, London, United Kingdom",
  "* Corresponding author: ada@example.org",
]);
assert.equal(standard.authorList, "Lovelace, Ada; Babbage, Charles; Hopper, Grace");
assert.equal(standard.correspondingAuthors, "Lovelace, Ada — ada@example.org");
assert.equal(standard.extractionStatus, "Extracted — verify against PDF");

const missingMarker = extractAuthorMetadataFromLines([
  "A Sample Abstract",
  "Lovelace, Ada¹; Babbage, Charles²",
  "¹ Department of Computing, Example University",
  "² Institute of Engines, Example Academy",
  "Corresponding author: ada@example.org",
]);
assert.match(missingMarker.extractionStatus, /^Needs review:/);
assert.equal(missingMarker.correspondingAuthors, "ada@example.org");

const missingLine = extractAuthorMetadataFromLines(["A Sample Abstract", "Lovelace, Ada"]);
assert.match(missingLine.extractionStatus, /^Needs review:/);

const wrappedAuthors = extractAuthorMetadataFromLines([
  "A Sample Abstract",
  "Lovelace, Ada¹*; Babbage, Charles²;",
  "Hopper, Grace¹; Hamilton, Margaret²†",
  "¹ Department of Computing, Example University",
  "² Institute of Engines, Example Academy",
  "* Corresponding author: ada@example.org",
  "† Corresponding author: margaret@example.org",
]);
assert.equal(wrappedAuthors.authorList,
  "Lovelace, Ada; Babbage, Charles; Hopper, Grace; Hamilton, Margaret");
assert.equal(wrappedAuthors.correspondingAuthors,
  "Lovelace, Ada — ada@example.org; Hamilton, Margaret — margaret@example.org");

const fixturePath = process.argv[2];
if (fixturePath) {
  const extracted = await extractPdfAuthorMetadata(fs.readFileSync(fixturePath));
  assert.match(extracted.authorList, /Family name, Given name/);
  assert.match(extracted.correspondingAuthors, /email@example\.com/);
  assert.equal(extracted.extractionStatus, "Extracted — verify against PDF");
}

console.log("PDF author extraction tests passed.");

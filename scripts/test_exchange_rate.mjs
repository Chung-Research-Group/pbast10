#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { parseEcbXml, renderRegistrationFallback } from "./update_exchange_rate.mjs";

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube time='2026-08-07'>
      <Cube currency='USD' rate='1.1535'/>
      <Cube currency='KRW' rate='1633.30'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const parsed = parseEcbXml(sample, new Date("2026-08-08T00:00:00Z"));
assert.equal(parsed.effectiveDate, "2026-08-07");
assert.equal(parsed.sourceRates.USD, 1.1535);
assert.equal(parsed.sourceRates.KRW, 1633.3);
assert.ok(Math.abs(parsed.rate - 1415.951452) < 1e-6);
assert.ok(Math.abs((parsed.rate * parsed.sourceRates.USD) - parsed.sourceRates.KRW) < 1e-5);

assert.throws(
  () => parseEcbXml(sample.replace("currency='KRW'", "currency='JPY'"), new Date("2026-08-08T00:00:00Z")),
  /missing finite USD or KRW rates/
);
assert.throws(
  () => parseEcbXml(
    sample.replace("rate='1.1535'", "rate='-1'").replace("rate='1633.30'", "rate='-1415.951452'"),
    new Date("2026-08-08T00:00:00Z")
  ),
  /outside safety bounds/
);
assert.throws(
  () => parseEcbXml(sample, new Date("2026-09-01T00:00:00Z")),
  /implausible or stale/
);

const stored = JSON.parse(await readFile(resolve("data/exchange-rate.json"), "utf8"));
assert.equal(stored.baseCurrency, "USD");
assert.equal(stored.quoteCurrency, "KRW");
assert.equal(stored.source, "European Central Bank");
assert.match(stored.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(Number.isFinite(stored.rate) && stored.rate >= 500 && stored.rate <= 3000);
assert.ok(Math.abs((stored.rate * stored.sourceRates.USD) - stored.sourceRates.KRW) < 1e-5);

// Payment amounts were independently read from KIChE's Korean basket on 2026-10-28.
assert.equal(stored.locked, true, "Registration fees must not follow market FX");
assert.deepEqual(stored.confirmedPaymentAmounts.earlyBird, {
  regular: 861000, student: 530000, accompanyingSpouse: 265000
});
assert.deepEqual(stored.calculatedStandardKrw.amounts, {
  regular: 1060000, student: 596000, accompanyingSpouse: 265000
});
// User-directed proportional calculation, checked independently against fixed data.
const standardKrw = [861000 * 800 / 650, 530000 * 450 / 400, 265000 * 200 / 200]
  .map(amount => Math.round(amount / 1000) * 1000);
assert.deepEqual(standardKrw, Object.values(stored.calculatedStandardKrw.amounts));

const registration = await readFile(resolve("registration.html"), "utf8");
// Even extreme future rates must not change fixed registration fees.
for (const rate of [500, 1324.452783, 3000]) {
  assert.equal(renderRegistrationFallback(registration, { ...stored, rate }), registration);
}
const confirmedFees = [...registration.matchAll(/data-fixed-krw="(\d+)">KRW ([\d,]+)/g)];
assert.deepEqual(confirmedFees.map(([, amount]) => Number(amount)), [861000, 1060000, 530000, 596000, 265000, 265000]);
for (const [, amount, displayed] of confirmedFees) {
  assert.equal(Number(displayed.replaceAll(",", "")), Number(amount));
}
// Cross-check every published amount against the independently stored historical rate.
assert.deepEqual([650, 800, 400, 450, 200, 200].map(usd => Math.round(usd * stored.rate / 1000) * 1000), [861000, 1060000, 530000, 596000, 265000, 265000]);
assert.doesNotMatch(registration, /data-usd-fee|data-krw-equivalent|<script[^>]+exchange-rate/);
assert.doesNotMatch(registration, /portal will open soon|final payment amounts may vary|431,000/);
assert.doesNotMatch(registration, /confirmation pending|awaiting|invited speakers|Payment access|Fixed KRW fees/i);
for (const requiredText of [
  'href="https://www.kiche.or.kr/_ScR2/ko"',
  'href="https://www.kiche.or.kr/_ScR2/en"',
  "Through March 31, 2027", "April 1–June 3, 2027",
  "Conference sessions, lunches, Welcome Reception, and Gala Dinner (Banquet).",
  "Welcome Reception, Gala Dinner (Banquet), and conference tour.",
  "Available only for the spouse of a registered participant."
]) {
  assert.ok(registration.includes(requiredText), `Missing payment information: ${requiredText}`);
}

const workflow = await readFile(resolve(".github/workflows/exchange-rate.yml"), "utf8");
assert.doesNotMatch(workflow, /schedule:|cron:|contents: write|pull-requests: write|gh pr|git push/);
assert.match(workflow, /workflow_dispatch:/);

// Cached old pages cannot fetch a live rate through the compatibility script.
const browserScript = await readFile(resolve("js/exchange-rate.js"), "utf8");
vm.runInNewContext(browserScript, {
  fetch() { assert.fail("Browser exchange-rate fetching must remain disabled"); },
  document: new Proxy({}, { get() { assert.fail("Compatibility script must not change fee DOM"); } })
});
// A stale/manual invocation of the legacy updater must be harmless and offline.
const dataBefore = await readFile(resolve("data/exchange-rate.json"), "utf8");
const output = execFileSync(process.execPath, ["scripts/update_exchange_rate.mjs"], { encoding: "utf8", timeout: 2000 });
assert.match(output, /fixed; exchange-rate updates are disabled/);
assert.equal(await readFile(resolve("data/exchange-rate.json"), "utf8"), dataBefore);
assert.equal(await readFile(resolve("registration.html"), "utf8"), registration);

console.log("Fixed registration fees and exchange-rate lock tests passed.");

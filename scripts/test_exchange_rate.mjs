#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

const registration = await readFile(resolve("registration.html"), "utf8");
assert.equal(renderRegistrationFallback(registration, stored), registration);
const feeRows = [...registration.matchAll(/data-usd-fee="(\d+)"[^>]*>USD \d+<span class="fee-krw" data-krw-equivalent>([^<]+)<\/span>/g)];
assert.equal(feeRows.length, 6);
for (const [, rawUsd, displayedKrw] of feeRows) {
  const roundedKrw = Math.round((Number(rawUsd) * stored.rate) / 1000) * 1000;
  assert.equal(displayedKrw, `≈ KRW ${roundedKrw.toLocaleString("en-US")}`);
}

console.log("Exchange-rate calculation tests passed.");

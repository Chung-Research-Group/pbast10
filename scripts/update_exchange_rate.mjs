#!/usr/bin/env node
"use strict";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ECB_DATA_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_SOURCE_URL = "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html";

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=['\"]([^'\"]+)['\"]`));
  return match ? match[1] : null;
}

export function parseEcbXml(xml, now = new Date()) {
  const dateMatch = xml.match(/<Cube\b[^>]*\btime=['\"](\d{4}-\d{2}-\d{2})['\"][^>]*>/);
  if (!dateMatch) throw new Error("ECB response does not contain an effective date");

  const rates = {};
  for (const match of xml.matchAll(/<Cube\b[^>]*>/g)) {
    const currency = readAttribute(match[0], "currency");
    const rawRate = readAttribute(match[0], "rate");
    if (currency && rawRate) rates[currency] = Number(rawRate);
  }

  const usd = rates.USD;
  const krw = rates.KRW;
  if (!Number.isFinite(usd) || !Number.isFinite(krw)) {
    throw new Error("ECB response is missing finite USD or KRW rates");
  }
  if (usd < 0.5 || usd > 2.5 || krw < 500 || krw > 3000) {
    throw new Error("ECB source rates are outside safety bounds");
  }

  const rate = krw / usd;
  if (!Number.isFinite(rate) || rate < 500 || rate > 3000) {
    throw new Error("Derived USD/KRW rate is outside safety bounds");
  }

  const effectiveDate = dateMatch[1];
  const effectiveTime = Date.parse(effectiveDate + "T00:00:00Z");
  const ageDays = (now.getTime() - effectiveTime) / 86400000;
  if (!Number.isFinite(effectiveTime) || ageDays < -1 || ageDays > 10) {
    throw new Error("ECB effective date is implausible or stale");
  }

  return {
    baseCurrency: "USD",
    quoteCurrency: "KRW",
    rate: Number(rate.toFixed(6)),
    effectiveDate,
    source: "European Central Bank",
    sourceUrl: ECB_SOURCE_URL,
    sourceRates: {
      USD: usd,
      KRW: krw
    },
    calculation: "EUR/KRW divided by EUR/USD"
  };
}

export async function fetchExchangeRate(fetchImpl = fetch, now = new Date()) {
  const response = await fetchImpl(ECB_DATA_URL, {
    headers: { "User-Agent": "PBAST10 exchange-rate updater (https://pbast10.org/)" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`ECB request failed with HTTP ${response.status}`);
  return parseEcbXml(await response.text(), now);
}

export function renderRegistrationFallback(source, data) {
  let feeCount = 0;
  let rendered = source.replace(
    /(<td data-usd-fee="(\d+)"[^>]*>USD \d+<span class="fee-krw" data-krw-equivalent>)[^<]+(<\/span>)/g,
    (match, prefix, rawUsd, suffix) => {
      feeCount += 1;
      const roundedKrw = Math.round((Number(rawUsd) * data.rate) / 1000) * 1000;
      return `${prefix}≈ KRW ${roundedKrw.toLocaleString("en-US")}${suffix}`;
    }
  );
  if (feeCount !== 6) throw new Error(`Expected six registration fees, found ${feeCount}`);

  const ratePattern = /<span data-exchange-rate>[^<]+<\/span>/;
  const datePattern = /<time datetime="[^"]+" data-exchange-rate-date>[^<]+<\/time>/;
  if (!ratePattern.test(rendered) || !datePattern.test(rendered)) {
    throw new Error("Registration exchange-rate note markers are missing");
  }

  const displayRate = data.rate.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const displayDate = new Date(data.effectiveDate + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  });
  rendered = rendered
    .replace(ratePattern, `<span data-exchange-rate>USD 1 ≈ KRW ${displayRate}</span>`)
    .replace(datePattern, `<time datetime="${data.effectiveDate}" data-exchange-rate-date>${displayDate}</time>`);

  return rendered;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outputPath = resolve(root, "data/exchange-rate.json");
  const registrationPath = resolve(root, "registration.html");
  const data = await fetchExchangeRate();
  const registration = renderRegistrationFallback(await readFile(registrationPath, "utf8"), data);
  await mkdir(dirname(outputPath), { recursive: true });
  await Promise.all([
    writeFile(outputPath, JSON.stringify(data, null, 2) + "\n", "utf8"),
    writeFile(registrationPath, registration, "utf8")
  ]);
  console.log(`USD 1 = KRW ${data.rate} (ECB ${data.effectiveDate})`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

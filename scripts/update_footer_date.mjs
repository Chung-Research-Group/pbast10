#!/usr/bin/env node
"use strict";

import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KST_TIME_ZONE = "Asia/Seoul";
const FOOTER_DATE_PATTERN = /<time datetime="(\d{4}-\d{2}-\d{2})" data-site-updated>Updated ([^<]+)<\/time>/g;

function dateParts(formatter, instant) {
  return Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function formatKstDate(timestamp) {
  const instant = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error(`Invalid site-update timestamp: ${timestamp}`);
  }

  const isoParts = dateParts(
    new Intl.DateTimeFormat("en-US", {
      timeZone: KST_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }),
    instant
  );
  const displayDate = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(instant);

  return {
    isoDate: `${isoParts.year}-${isoParts.month}-${isoParts.day}`,
    displayDate
  };
}

export function renderFooterDate(source, date, fileName = "HTML source") {
  const matches = [...source.matchAll(FOOTER_DATE_PATTERN)];
  if (matches.length !== 1) {
    throw new Error(`${fileName}: expected one site-update footer marker, found ${matches.length}`);
  }

  const replacement = `<time datetime="${date.isoDate}" data-site-updated>Updated ${date.displayDate}</time>`;
  return source.replace(FOOTER_DATE_PATTERN, replacement);
}

export function resolveBuildTimestamp(environment = process.env) {
  if (environment.SITE_UPDATED_AT) return environment.SITE_UPDATED_AT;

  try {
    return execFileSync("git", ["log", "-1", "--format=%cI", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    // A deploy archive may not include .git; its build time is then the best available timestamp.
    return new Date().toISOString();
  }
}

export async function updateRootFooters(root, timestamp) {
  const date = formatKstDate(timestamp);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".html")
    .sort((left, right) => left.name.localeCompare(right.name));

  let footerCount = 0;
  let changedCount = 0;
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    const source = await readFile(path, "utf8");
    if (!source.includes('class="site-footer"')) continue;

    footerCount += 1;
    const rendered = renderFooterDate(source, date, entry.name);
    if (rendered !== source) {
      await writeFile(path, rendered, "utf8");
      changedCount += 1;
    }
  }

  if (footerCount === 0) throw new Error("No public HTML footers were found");
  return { ...date, footerCount, changedCount };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await updateRootFooters(root, resolveBuildTimestamp());
  console.log(
    `Stamped ${result.footerCount} page footers with ${result.displayDate} (Asia/Seoul); ${result.changedCount} file(s) changed.`
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

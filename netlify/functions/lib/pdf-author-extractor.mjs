import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const CORRESPONDING_LABEL = /corresponding\s+author(?:s)?/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MARKERS = "*†‡§¶#";
const AFFILIATION_START = /^[\s¹²³⁴⁵⁶⁷⁸⁹⁰0-9,*†‡§¶#]+(?=\p{L})/u;
const AFFILIATION_WORDS = /\b(department|university|institute|institution|college|school|laboratory|laboratoire|centre|center|academy|faculty|division|corporation|company|gmbh|ltd)\b/i;

export async function extractPdfAuthorMetadata(bytes) {
  // PDF.js rejects Node.js Buffer even though Buffer extends Uint8Array.
  const data = Uint8Array.from(bytes);
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1) throw new Error("PDF has no pages.");
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const lines = linesFromTextItems(content.items);
    return extractAuthorMetadataFromLines(lines);
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

export function linesFromTextItems(items) {
  const lines = [];
  let current = "";

  for (const item of items || []) {
    const text = normalizeWhitespace(item?.str || "");
    if (text) current = joinPdfText(current, text);
    if (item?.hasEOL && current) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  return lines.map(normalizeWhitespace).filter(Boolean);
}

export function extractAuthorMetadataFromLines(inputLines) {
  const lines = (inputLines || []).map(normalizeWhitespace).filter(Boolean);
  const correspondingIndexes = lines
    .map((line, index) => CORRESPONDING_LABEL.test(line) ? index : -1)
    .filter((index) => index >= 0);
  const correspondingIndex = correspondingIndexes[0] ?? -1;

  if (correspondingIndex < 0) {
    return result("", "", "Needs review: corresponding-author line was not found.");
  }

  const correspondingLines = correspondingIndexes.map((index) => lines[index]);
  const firstAffiliationIndex = findFirstAffiliationIndex(lines, correspondingIndex);
  const authorLine = findAuthorLine(lines, firstAffiliationIndex, correspondingIndex);

  if (!authorLine) {
    return result("", correspondingEmailsOnly(correspondingLines),
      "Needs review: author line was not identified.");
  }

  const parsedAuthors = parseAuthorLine(authorLine);
  const emails = unique(correspondingLines.flatMap((line) => line.match(EMAIL_PATTERN) || []));
  const correspondingMarkers = correspondingLines.map(leadingMarker).filter(Boolean);
  const markedAuthors = parsedAuthors
    .filter((author) => correspondingMarkers.length
      ? correspondingMarkers.some((marker) => author.markers.includes(marker))
      : author.markers.includes("*"))
    .map((author) => author.name);

  const authorList = parsedAuthors.map((author) => author.name).filter(Boolean).join("; ");
  const correspondingAuthors = formatCorrespondingAuthors(markedAuthors, emails);

  if (!authorList) {
    return result("", correspondingAuthors,
      "Needs review: author names could not be parsed.");
  }
  if (!emails.length) {
    return result(authorList, correspondingAuthors,
      "Needs review: corresponding-author email was not found.");
  }
  if (!markedAuthors.length) {
    return result(authorList, correspondingAuthors,
      "Needs review: corresponding-author marker could not be linked to a name.");
  }

  return result(authorList, correspondingAuthors, "Extracted — verify against PDF");
}

function findFirstAffiliationIndex(lines, correspondingIndex) {
  for (let index = 0; index < correspondingIndex; index += 1) {
    const line = lines[index];
    if (AFFILIATION_START.test(line) && AFFILIATION_WORDS.test(line)) return index;
  }
  return -1;
}

function findAuthorLine(lines, firstAffiliationIndex, correspondingIndex) {
  if (firstAffiliationIndex > 0) {
    const lastCandidate = lines[firstAffiliationIndex - 1];
    const candidates = looksLikeAuthorLine(lastCandidate) ? [lastCandidate] : [];
    for (let index = firstAffiliationIndex - 2; candidates.length && index >= Math.max(0, firstAffiliationIndex - 5); index -= 1) {
      const candidate = lines[index];
      if (!looksLikeAuthorLine(candidate) || !/[;*†‡§¶#¹²³⁴⁵⁶⁷⁸⁹⁰]/.test(candidate)) break;
      candidates.unshift(candidate);
    }
    if (candidates.length) return candidates.join(" ");
  }

  const lowerBound = Math.max(0, correspondingIndex - 8);
  for (let index = correspondingIndex - 1; index >= lowerBound; index -= 1) {
    if (looksLikeAuthorLine(lines[index]) && !AFFILIATION_WORDS.test(lines[index])) return lines[index];
  }
  return "";
}

function looksLikeAuthorLine(line) {
  if (!line || CORRESPONDING_LABEL.test(line) || EMAIL_PATTERN.test(line)) {
    EMAIL_PATTERN.lastIndex = 0;
    return false;
  }
  EMAIL_PATTERN.lastIndex = 0;
  return line.includes(",") && !/\b(May|June|July|August|September|October|November|December)\b/i.test(line);
}

function parseAuthorLine(line) {
  return line.split(/\s*;\s*/).map((entry) => {
    const markers = [...entry].filter((character) => MARKERS.includes(character)).join("");
    const name = normalizeWhitespace(entry
      .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, "")
      .replace(/\b\d+\b/g, "")
      .replace(/[*†‡§¶#]+/g, "")
      .replace(/\s+,/g, ",")
      .replace(/,\s*/g, ", "));
    return { name, markers };
  }).filter((author) => author.name);
}

function leadingMarker(line) {
  const beforeLabel = line.split(CORRESPONDING_LABEL)[0] || "";
  return [...beforeLabel].find((character) => MARKERS.includes(character)) || "";
}

function correspondingEmailsOnly(lines) {
  return unique(lines.flatMap((line) => line.match(EMAIL_PATTERN) || [])).join("; ");
}

function formatCorrespondingAuthors(names, emails) {
  if (!names.length) return emails.join("; ");
  if (names.length === emails.length) {
    return names.map((name, index) => `${name} — ${emails[index]}`).join("; ");
  }
  return `${names.join("; ")}${emails.length ? ` — ${emails.join("; ")}` : ""}`;
}

function joinPdfText(current, next) {
  if (!current) return next;
  if (/[\s(\/-]$/.test(current) || /^[,.;:)\]}]/.test(next)) return current + next;
  return `${current} ${next}`;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function result(authorList, correspondingAuthors, extractionStatus) {
  return { authorList, correspondingAuthors, extractionStatus };
}

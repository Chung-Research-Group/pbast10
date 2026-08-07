#!/usr/bin/env node
"use strict";

import assert from "node:assert/strict";
import { formatKstDate, renderFooterDate } from "./update_footer_date.mjs";

assert.deepEqual(formatKstDate("2026-08-07T14:59:59Z"), {
  isoDate: "2026-08-07",
  displayDate: "August 7, 2026"
});
assert.deepEqual(formatKstDate("2026-08-07T15:00:00Z"), {
  isoDate: "2026-08-08",
  displayDate: "August 8, 2026"
});
assert.throws(() => formatKstDate("not-a-date"), /Invalid site-update timestamp/);

const fixture = `
<p>Travel information checked in July 2026.</p>
<footer class="site-footer">
  <time datetime="2026-07-01" data-site-updated>Updated July 2026</time>
</footer>`;
const rendered = renderFooterDate(fixture, formatKstDate("2026-08-07T15:00:00Z"), "fixture.html");
assert.match(
  rendered,
  /<time datetime="2026-08-08" data-site-updated>Updated August 8, 2026<\/time>/
);
assert.match(rendered, /Travel information checked in July 2026\./);

assert.throws(
  () => renderFooterDate("<footer class=\"site-footer\"></footer>", formatKstDate("2026-08-08"), "missing.html"),
  /expected one site-update footer marker, found 0/
);
assert.throws(
  () => renderFooterDate(`${fixture}${fixture}`, formatKstDate("2026-08-08"), "duplicate.html"),
  /expected one site-update footer marker, found 2/
);

console.log("Footer date tests passed.");

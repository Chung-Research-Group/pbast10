// Keeps the Apps Script shared secret server-side while loading a submission.
export default async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const webhookUrl = Netlify.env.get("GOOGLE_SHEETS_WEBHOOK_URL");
  const syncSecret = Netlify.env.get("SHEETS_SYNC_SECRET");
  if (!webhookUrl || !syncSecret) {
    return json({ ok: false, error: "Revision service is not configured." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const action = body.action === undefined ? "get" : body.action;
  if (!["get", "withdraw"].includes(action)) {
    return json({ ok: false, error: "Unsupported action." }, 400);
  }
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return json({ ok: false, error: "This revision link is invalid or has expired." }, 400);
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: syncSecret, action, token }),
    });
    const message = await response.text();
    let result;
    try { result = JSON.parse(message); } catch (_) { result = null; }

    if (!response.ok || !result) {
      return json({ ok: false, error: "The revision service is temporarily unavailable." }, 502);
    }
    if (result.ok !== true) {
      return json({ ok: false, code: result.code, error: result.error || "This revision link is invalid or has expired." }, 400);
    }
    return json(result, 200);
  } catch (error) {
    console.error("Revision lookup failed", error);
    return json({ ok: false, error: "The revision service is temporarily unavailable." }, 502);
  }
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

// Limit token lookups per visitor so abusive traffic cannot exhaust the
// downstream Apps Script execution quota.
export const config = {
  path: "/.netlify/functions/abstract-revision-api",
  rateLimit: {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

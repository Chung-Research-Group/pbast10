// Private relay between the owner-only PBAST10 dashboard and Apps Script.
// The repository stores only the legacy SHA-256 token digest. A second digest
// can be supplied through Netlify during a zero-downtime token rotation. The
// bearer tokens themselves remain only in the dashboard runtimes.
const ADMIN_TOKEN_SHA256 =
  "9db6ce2aa54281eed9fe12af1e2e4a32099a7a4892e6ffa110ed2414831d357e";
const ROTATED_TOKEN_SHA256_ENV = "PBAST10_ADMIN_TOKEN_SHA256";

export function makeHandler({
  tokenSha256 = ADMIN_TOKEN_SHA256,
  additionalTokenSha256,
} = {}) {
  return async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }
  const acceptedTokenHashes = normalizeTokenHashes([
    tokenSha256,
    additionalTokenSha256 ?? Netlify.env.get(ROTATED_TOKEN_SHA256_ENV),
  ]);
  if (!(await authorized(request.headers.get("authorization"), acceptedTokenHashes))) {
    return json({ ok: false, error: "Unauthorized." }, 401);
  }

  const webhookUrl = Netlify.env.get("GOOGLE_SHEETS_WEBHOOK_URL");
  const syncSecret = Netlify.env.get("SHEETS_SYNC_SECRET");
  if (!webhookUrl || !syncSecret) {
    return json({ ok: false, error: "Google Sheets sync is not configured." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const action = body.action;
  if (!["list", "update", "delete", "acceptance-email", "reviewer-invite"].includes(action)) {
    return json({ ok: false, error: "Unsupported action." }, 400);
  }

  let forwarded;
  if (action === "list") {
    forwarded = { secret: syncSecret, action: "admin-list" };
  } else if (action === "update") {
    forwarded = {
      secret: syncSecret,
      action: "admin-update",
      submissionId: body.submissionId,
      expectedFingerprint: body.expectedFingerprint,
      changes: body.changes,
    };
  } else if (action === "delete") {
    forwarded = {
      secret: syncSecret,
      action: "admin-delete",
      items: body.items,
    };
  } else if (action === "acceptance-email") {
    forwarded = {
      secret: syncSecret,
      action: "admin-acceptance-email",
      submissionId: body.submissionId,
      expectedFingerprint: body.expectedFingerprint,
    };
  } else {
    forwarded = {
      secret: syncSecret,
      action: "admin-reviewer-invite",
      email: body.email,
      name: body.name,
      temporaryPasscode: body.temporaryPasscode,
      loginUrl: body.loginUrl,
      deadline: body.deadline,
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(forwarded),
    });
    const message = await response.text();
    let result;
    try {
      result = JSON.parse(message);
    } catch {
      result = null;
    }
    if (!response.ok || !result) {
      return json(
        { ok: false, error: "The Google Sheets service returned an invalid response." },
        502,
      );
    }
    if (result.ok !== true) {
      const status =
        result.code === "SYNC_CONFLICT"
          ? 409
          : result.code === "NOT_FOUND"
            ? 404
            : 400;
      return json(
        {
          ok: false,
          code: result.code,
          error: result.error || "Google Sheets rejected the request.",
        },
        status,
      );
    }
    return json(result, 200);
  } catch (error) {
    console.error("Administrator Google Sheets relay failed", error);
    return json({ ok: false, error: "Google Sheets is temporarily unavailable." }, 502);
  }
  };
}

export default makeHandler();

async function authorized(header, expectedHashes) {
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(String(header || ""));
  if (!match || expectedHashes.length === 0) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(match[1]),
  );
  const actual = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  let authorized = 0;
  for (const expectedHash of expectedHashes) {
    authorized |= Number(constantTimeEqual(actual, expectedHash));
  }
  return authorized === 1;
}

function normalizeTokenHashes(values) {
  return [
    ...new Set(
      values
        .flatMap((value) => String(value ?? "").split(","))
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-f0-9]{64}$/.test(value)),
    ),
  ];
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

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

export const config = {
  path: "/.netlify/functions/admin-abstract-sync",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

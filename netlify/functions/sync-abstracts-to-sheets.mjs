// Runs after Netlify verifies a form submission and forwards it to Google Sheets.
export default {
  async formSubmitted(event) {
    const data = event.data || {};
    // Netlify may omit its system form-name field from the verified event data.
    // Infer the form from fields unique to the two PBAST10 workflows.
    const formName = data["form-name"]
      || ((data["edit-token"] || data["revision-id"]) ? "abstract-revision" : "")
      || (data["submission-id"] ? "abstract-submission" : "");

    // Ignore unrelated Netlify forms.
    if (!["abstract-submission", "abstract-revision"].includes(formName)) return;

    const uploadedPdf = validatePdfUpload(data["abstract-file"]);
    await validatePdfSignature(uploadedPdf.url);

    const webhookUrl = Netlify.env.get("GOOGLE_SHEETS_WEBHOOK_URL");
    const syncSecret = Netlify.env.get("SHEETS_SYNC_SECRET");

    if (!webhookUrl || !syncSecret) {
      console.error("Google Sheets sync is not configured: missing environment variables.");
      return;
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: syncSecret,
        action: formName === "abstract-revision" ? "revise" : "create",
        submissionId: data["submission-id"] || "",
        eventId: data["revision-id"] || data["submission-id"] || "",
        submittedAt: new Date().toISOString(),
        data,
      }),
    });

    const message = await response.text();
    let result = null;
    try { result = JSON.parse(message); } catch (_) { /* handled below */ }

    if (!response.ok || !result || result.ok !== true) {
      throw new Error(`Google Sheets sync failed (${response.status}): ${message.slice(0, 500)}`);
    }
  },
};

function validatePdfUpload(value) {
  let files = value;
  if (typeof files === "string") {
    try { files = JSON.parse(files); } catch (_) { throw new Error("Abstract upload metadata is invalid."); }
  }
  const file = Array.isArray(files) ? files[0] : files;
  if (!file || typeof file !== "object") throw new Error("A PDF abstract file is required.");

  const filename = String(file.filename || file.name || "").trim();
  const fileUrl = String(file.url || file.secure_url || "").trim();
  const size = Number(file.size);
  const mime = String(file.content_type || file.contentType || file.mime_type || file.mimeType || "").toLowerCase();

  if (!/\.pdf$/i.test(filename)) throw new Error("Only PDF abstract files are accepted.");
  if (!Number.isFinite(size) || size < 1 || size > 7.5 * 1024 * 1024) {
    throw new Error("The PDF abstract file must be no larger than 7.5 MB.");
  }
  if (mime && mime !== "application/pdf") throw new Error("The uploaded file is not a PDF.");

  let parsedUrl;
  try { parsedUrl = new URL(fileUrl); } catch (_) { throw new Error("Abstract upload URL is invalid."); }
  if (parsedUrl.protocol !== "https:") throw new Error("Abstract upload URL must use HTTPS.");
  return { filename, size, url: parsedUrl.toString() };
}

async function validatePdfSignature(fileUrl) {
  const response = await fetch(fileUrl, { headers: { range: "bytes=0-1023" } });
  if (!response.ok) throw new Error("The uploaded PDF could not be verified.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  if (!prefix.includes("%PDF-")) throw new Error("The uploaded file does not contain a valid PDF header.");
}

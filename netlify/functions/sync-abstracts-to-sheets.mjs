// Runs after Netlify verifies a form submission and forwards it to Google Sheets.
export default {
  async formSubmitted(event) {
    const data = event.data || {};
    const formName = data["form-name"] || "";

    // Ignore unrelated Netlify forms.
    if (!["abstract-submission", "abstract-revision"].includes(formName)) return;

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

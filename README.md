# PBAST10 — Conference Website

The 10th Pacific Basin Conference on Adsorption Science & Technology

May 31–June 3, 2027 · Yonsei University, Seoul, Republic of Korea

Live at https://pbast10.org

## Structure

```
index.html               Home (hero, welcome, dates, topics, call for abstracts, sponsors)
speakers.html            Speakers & Committee (Plenary / Keynote / Invited / Committee tabs)
registration.html        Fees & key dates
data/exchange-rate.json  Latest ECB-derived USD/KRW reference rate
abstract-submission.html Netlify abstract form with required file upload
revise-abstract.html     Private token-based abstract review/revision form
thank-you.html           Successful form-submission destination
program.html             Topics & program
venue.html               Venue & accommodation
getting-to-yonsei.html   Directions from ICN airport
visa.html                K-ETA / C-3 visa & invitation letter
sponsorship.html         Sponsorship tiers
css/style.css            All styles (design tokens in :root)
js/tabs.js               Tab switcher for speakers page
js/mobile-nav.js         Accessible mobile navigation
js/exchange-rate.js      KRW fee conversion from the daily reference-rate data
js/revision-form.js      Secure revision lookup, prefill, and file validation
netlify/functions/       Verified form submission -> Google Sheets sync
google-apps-script/      Google Sheets web-app receiver and setup guide
scripts/check_site.py    Static link, metadata, image, and structure checks
scripts/update_footer_date.mjs  Build-time KST footer-date stamp
scripts/update_exchange_rate.mjs  Daily ECB rate fetch and validation
netlify.toml              Netlify build command and publish directory
robots.txt / sitemap.xml Search-engine discovery files
_headers                  Netlify security and cache headers
404.html                  Netlify-compatible not-found page
assets/                   Images, local fonts, speakers, committee, and logo
```

Plain static HTML/CSS/JS with one dependency-free build step. Netlify stamps every
public footer with the deployed Git commit date in Korea time, then publishes this folder.
Other static hosts should run `node scripts/update_footer_date.mjs` before publishing.

## Editing notes

- **Colors & fonts** — design tokens at the top of `css/style.css` (`:root`).
- **Sponsor logos** — add confirmed logos only after permission is recorded, then update the sponsor section in `index.html`.
- **Speaker photos** — drop images in `assets/speakers/` and update `speakers.html`.
- **Abstract form** — fields and the PDF-only upload restriction are in `abstract-submission.html`. Netlify's total form request limit is 8 MB, so the client-side file limit is 7.5 MB. The Netlify event handler and Apps Script receiver also validate the uploaded file metadata.
- **Contact email** — in the footer of every page and on `sponsorship.html`.
- **Footer date** — keep the `data-site-updated` marker in each public footer. Netlify replaces its fallback date with the deployed commit date in `Asia/Seoul` on every build.
- **Exchange rate** — `.github/workflows/exchange-rate.yml` checks the official ECB reference rates daily at 16:30 UTC (01:30 KST). When a new working-day rate is published, it creates a dated automation branch and pull request, then merges it through the repository's protected-branch path. It updates both `data/exchange-rate.json` and the registration-page fallback. USD/KRW is calculated as EUR/KRW divided by EUR/USD; registration estimates are rounded to the nearest KRW 1,000.
- **Pre-commit checks** — run `python scripts/check_site.py` and `node scripts/test_footer_date.mjs`.

## Netlify

The publish directory is the repo root. After merging and deploying the form:

1. In Netlify, open **Forms** and make sure form detection is enabled.
2. Trigger a new production deploy so Netlify detects `abstract-submission`.
3. Submit one small test PDF through the live form.
4. Confirm the submission and uploaded file appear under **Forms → abstract-submission**.
5. Under **Project configuration → Notifications → Form submission notifications**, add the organizing committee email.
6. Keep Netlify spam filtering enabled and review submissions regularly.

## Google Sheets workflow

Verified submissions can be copied automatically to the shared `PBAST10 Abstract Submission Tracker`. Follow `google-apps-script/README.md` to deploy the receiver and add the two required Netlify environment variables. The integration uses per-event UUIDs to prevent duplicate processing if an event is retried. It also emails a private revision link, keeps the latest version in `Abstract Tracker`, and appends every version to `Revision History`.

Uploaded abstracts may contain personal information. Limit Netlify access to committee members who need it, define a retention/deletion schedule, and do not collect passports or government IDs in this form.

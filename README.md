# PBAST10 — Conference Website

The 10th Pacific Basin Conference on Adsorption Science & Technology

May 31 – June 3, 2027 · Yonsei University, Seoul, Republic of Korea

Live at https://pbast10.org (Netlify + Squarespace DNS)

## Structure

```
index.html               Home (hero, welcome, dates, topics, call for abstracts, sponsors)
speakers.html            Speakers & Committee (Plenary / Keynote / Invited / Committee tabs)
registration.html        Fees & key dates
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
js/revision-form.js      Secure revision lookup, prefill, and file validation
netlify/functions/       Verified form submission -> Google Sheets sync
google-apps-script/      Google Sheets web-app receiver and setup guide
scripts/check_site.py    Static link, metadata, image, and structure checks
robots.txt / sitemap.xml Search-engine discovery files
_headers                  Netlify security and cache headers
404.html                  Netlify-compatible not-found page
assets/                   Images, local fonts, speakers, committee, and logo
```

Plain static HTML/CSS/JS — no build step. Deploy by pointing any static host
(Netlify, GitHub Pages, Cloudflare Pages) at this folder.

## Editing notes

- **Colors & fonts** — design tokens at the top of `css/style.css` (`:root`).
- **Sponsor logos** — add confirmed logos only after permission is recorded, then update the sponsor section in `index.html`.
- **Speaker photos** — drop images in `assets/speakers/` and update `speakers.html`.
- **Abstract form** — fields and accepted file types are in `abstract-submission.html`. Netlify's total form request limit is 8 MB, so the client-side file limit is 7.5 MB.
- **Contact email** — in the footer of every page and on `sponsorship.html`.
- **Pre-commit check** — run `python scripts/check_site.py`.

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

# PBAST10 — Conference Website

The 10th Pacific Basin Conference on Adsorption Science & Technology
May 31 – June 3, 2027 · Yonsei University, Seoul, Korea
Live at https://pbast10.org (Netlify + Squarespace DNS)

## Structure

```
index.html               Home (hero, welcome, dates, topics, call for abstracts, sponsors)
speakers.html            Speakers & Committee (Plenary / Keynote / Invited / Committee tabs)
registration.html        Fees & key dates
program.html             Topics & program
venue.html               Venue & accommodation
getting-to-yonsei.html   Directions from ICN airport
visa.html                K-ETA / C-3 visa & invitation letter
sponsorship.html         Sponsorship tiers
css/style.css            All styles (design tokens in :root)
js/tabs.js               Tab switcher for speakers page
assets/                  Images (hero, speakers, committee, logo)
```

Plain static HTML/CSS/JS — no build step. Deploy by pointing any static host
(Netlify, GitHub Pages, Cloudflare Pages) at this folder.

## Editing notes

- **Colors & fonts** — design tokens at the top of `css/style.css` (`:root`).
- **Sponsor logos** — on `index.html`, replace the `.logo-slot` placeholder divs
  with `<img src="assets/sponsors/NAME.png" alt="NAME">` (create `assets/sponsors/`).
- **Speaker photos** — drop images in `assets/speakers/` and update `speakers.html`.
- **Abstract form** — Google Form URL appears twice in `index.html`.
- **Contact email** — in the footer of every page and on `sponsorship.html`.

## Netlify

No configuration required; publish directory is the repo root.

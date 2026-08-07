#!/usr/bin/env python3
"""Dependency-free checks for common static-site regressions."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
import json
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
HTML_FILES = sorted(ROOT.glob("*.html"))
errors = []
titles = {}
descriptions = {}


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.title_count = 0
        self.in_title = False
        self.h1_count = 0
        self.description = ""
        self.canonical = ""
        self.links = []
        self.images = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == "title":
            self.title_count += 1
            self.in_title = True
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "meta" and data.get("name") == "description":
            self.description = data.get("content", "").strip()
        elif tag == "link" and data.get("rel") == "canonical":
            self.canonical = data.get("href", "")
        elif tag == "a" and data.get("href"):
            self.links.append(data["href"])
        elif tag == "img":
            self.images.append(data)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


for path in HTML_FILES:
    source = path.read_text(encoding="utf-8")
    parser = PageParser()
    parser.feed(source)
    rel = path.name

    if parser.h1_count != 1:
        errors.append(f"{rel}: expected one h1, found {parser.h1_count}")
    if parser.title_count != 1:
        errors.append(f"{rel}: expected one title, found {parser.title_count}")
    if not parser.title.strip():
        errors.append(f"{rel}: missing title")
    elif parser.title in titles:
        errors.append(f"{rel}: duplicate title also used by {titles[parser.title]}")
    else:
        titles[parser.title] = rel
    if not parser.description:
        errors.append(f"{rel}: missing description")
    elif parser.description in descriptions:
        errors.append(f"{rel}: duplicate description also used by {descriptions[parser.description]}")
    else:
        descriptions[parser.description] = rel
    if rel not in {"404.html", "thank-you.html"} and not parser.canonical:
        errors.append(f"{rel}: missing canonical URL")
    if "forms.gle" in source or "fonts.googleapis.com" in source:
        errors.append(f"{rel}: blocked external Google dependency remains")
    if "pbast10.org@gmail.com" in source:
        errors.append(f"{rel}: retired Gmail contact remains")

    for image in parser.images:
        src = image.get("src", "")
        if not image.get("alt") and image.get("alt") != "":
            errors.append(f"{rel}: image missing alt attribute ({src})")
        if src.startswith(("http://", "https://")):
            errors.append(f"{rel}: externally hosted image ({src})")
        elif src and not (ROOT / src).exists():
            errors.append(f"{rel}: missing image ({src})")

    for href in parser.links:
        parsed = urlparse(href)
        if parsed.scheme or href.startswith(("#", "mailto:", "tel:")):
            continue
        target = href.split("#", 1)[0].split("?", 1)[0]
        if target and not (ROOT / target).exists():
            errors.append(f"{rel}: broken internal link ({href})")

if not (ROOT / "robots.txt").exists() or not (ROOT / "sitemap.xml").exists():
    errors.append("robots.txt or sitemap.xml is missing")

for form_page in ("abstract-submission.html", "revise-abstract.html"):
    source = (ROOT / form_page).read_text(encoding="utf-8")
    for marker in ("data-country-autocomplete", "data-institution-autocomplete", "js/autocomplete.js"):
        if marker not in source:
            errors.append(f"{form_page}: missing autocomplete integration ({marker})")

if not (ROOT / "js" / "autocomplete.js").exists():
    errors.append("js/autocomplete.js is missing")

home_source = (ROOT / "index.html").read_text(encoding="utf-8")
home_sections = ("Call for Abstracts", 'id="sponsors-title"', 'id="organized-by-title"')
home_positions = [home_source.find(marker) for marker in home_sections]
if any(position < 0 for position in home_positions):
    errors.append("index.html: missing Call for Abstracts, Sponsors, or Organized by section")
elif home_positions != sorted(home_positions):
    errors.append("index.html: expected section order Call for Abstracts -> Sponsors -> Organized by")

registration_source = (ROOT / "registration.html").read_text(encoding="utf-8")
for marker in ("data-usd-fee", "data-krw-equivalent", "data-exchange-rate", "js/exchange-rate.js"):
    if marker not in registration_source:
        errors.append(f"registration.html: missing exchange-rate integration ({marker})")

exchange_rate_path = ROOT / "data" / "exchange-rate.json"
if not exchange_rate_path.exists():
    errors.append("data/exchange-rate.json is missing")
else:
    try:
        exchange_rate = json.loads(exchange_rate_path.read_text(encoding="utf-8"))
        required_rate_fields = {
            "baseCurrency",
            "quoteCurrency",
            "rate",
            "effectiveDate",
            "source",
            "sourceUrl",
            "sourceRates",
        }
        if not required_rate_fields.issubset(exchange_rate):
            errors.append("data/exchange-rate.json: required fields are missing")
        elif exchange_rate["baseCurrency"] != "USD" or exchange_rate["quoteCurrency"] != "KRW":
            errors.append("data/exchange-rate.json: expected USD/KRW currencies")
        elif exchange_rate["source"] != "European Central Bank":
            errors.append("data/exchange-rate.json: unexpected exchange-rate source")
        else:
            expected_cross_rate = exchange_rate["sourceRates"]["KRW"] / exchange_rate["sourceRates"]["USD"]
            if not math.isclose(exchange_rate["rate"], expected_cross_rate, rel_tol=1e-9):
                errors.append("data/exchange-rate.json: USD/KRW cross-rate is inconsistent")
    except (json.JSONDecodeError, KeyError, TypeError, ZeroDivisionError) as exc:
        errors.append(f"data/exchange-rate.json: invalid data ({exc})")

admin_entry = (ROOT / "admin" / "index.html").read_text(encoding="utf-8")
admin_url = "https://pbast10-admin.drygchung.workers.dev/"
retired_admin_host = "pbast10-admin.drygchung.chatgpt.site"
if admin_entry.count(admin_url) != 3:
    errors.append("admin/index.html must use the Cloudflare admin URL in all redirect fallbacks")
if retired_admin_host in admin_entry:
    errors.append("admin/index.html still references the retired ChatGPT Sites admin host")

for path in (ROOT / "google-apps-script").glob("*"):
    if path.is_file():
        content = path.read_text(encoding="utf-8")
        if "pbast10.org@gmail.com" in content:
            errors.append(f"{path.relative_to(ROOT)}: retired Gmail contact remains")
        if retired_admin_host in content:
            errors.append(f"{path.relative_to(ROOT)}: retired ChatGPT Sites admin host remains")

if errors:
    print("Site checks failed:")
    print("\n".join(f"- {error}" for error in errors))
    sys.exit(1)

print(f"Site checks passed for {len(HTML_FILES)} HTML pages.")

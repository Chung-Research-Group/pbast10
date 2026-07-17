#!/usr/bin/env python3
"""Dependency-free checks for common static-site regressions."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
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

if errors:
    print("Site checks failed:")
    print("\n".join(f"- {error}" for error in errors))
    sys.exit(1)

print(f"Site checks passed for {len(HTML_FILES)} HTML pages.")

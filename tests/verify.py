"""Dependency-free checks for the public page. Run with python3 tests/verify.py."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import json
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text()


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.elements = []
        self.headings = []
        self.feed(source)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        self.elements.append((tag, attributes))
        if re.fullmatch(r"h[1-6]", tag):
            self.headings.append(int(tag[1]))

    def tags(self, name):
        return [attrs for tag, attrs in self.elements if tag == name]


DOC = Document(HTML)


class SiteChecks(unittest.TestCase):
    def test_landmarks_and_headings(self):
        for tag in ("header", "main", "footer", "h1"):
            self.assertEqual(len(DOC.tags(tag)), 1, tag)
        for section in DOC.tags("section"):
            self.assertIn("aria-labelledby", section)
        self.assertTrue(all(b <= a + 1 for a, b in zip(DOC.headings, DOC.headings[1:])))
        self.assertIn('href="#main"', HTML)
        for nav in DOC.tags("nav"):
            self.assertIn("aria-label", nav)

    def test_required_content(self):
        for text in ("Software engineer and technical", "co-founder", "Property made simple.",
                     "Principal Android Engineer", "5M+ installs", "4.6 ★",
                     "500K+ installs", "4.5 ★", "10M+ installs", "4.7 ★", "Redstor",
                     "BSc Computer Science", "cum laude", "Cape Town", "GitHub, lately.",
                     "contributions during the past year", "/in/damian-van-den-berg"):
            self.assertIn(text, HTML)
        self.assertEqual(len(DOC.tags("article")), 4)
        for stale in ("Porfolio", "Senior Android", "17k", "com.redstor.client"):
            self.assertNotIn(stale, HTML)

    def test_metadata_and_person(self):
        metas = {a.get("name", a.get("property")): a.get("content") for a in DOC.tags("meta")}
        for key in ("description", "og:title", "og:description", "og:url", "og:image",
                    "og:image:alt", "twitter:card", "twitter:image", "theme-color", "color-scheme"):
            self.assertTrue(metas.get(key), key)
        self.assertEqual(metas["twitter:card"], "summary_large_image")
        canonical = [a["href"] for a in DOC.tags("link") if a.get("rel") == "canonical"]
        self.assertEqual(canonical, ["https://damianvdb.github.io/"])
        profile = json.loads(re.search(r'<script type="application/ld\+json">(.+?)</script>', HTML, re.S)[1])
        self.assertEqual(profile["@type"], "ProfilePage")
        self.assertEqual(profile["url"], "https://damianvdb.github.io/")
        person = profile["mainEntity"]
        self.assertEqual(person["@type"], "Person")
        self.assertEqual(person["name"], "Damian van den Berg")
        self.assertEqual(person["alternateName"], "DamianvdB")
        self.assertEqual(len(person["sameAs"]), 4)
        self.assertEqual(metas["google-site-verification"], "VYIGnuUMxqv_en01QhR_OUlLpRbdeWg-qmM2JhYlNP8")

    def test_page_view_analytics(self):
        self.assertEqual(HTML.count("G-9W9T91DGRW"), 2)
        analytics_scripts = [
            script for script in DOC.tags("script")
            if script.get("src", "").startswith("https://www.googletagmanager.com/gtag/js")
        ]
        self.assertEqual(len(analytics_scripts), 1)
        self.assertIn("async", analytics_scripts[0])
        self.assertNotIn("enhanced_measurement", HTML)

    def test_search_discovery_files(self):
        robots = (ROOT / "robots.txt").read_text()
        self.assertIn("User-agent: *", robots)
        self.assertIn("Allow: /", robots)
        self.assertIn("Sitemap: https://damianvdb.github.io/sitemap.xml", robots)
        sitemap = ET.parse(ROOT / "sitemap.xml").getroot()
        namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(sitemap.findtext("s:url/s:loc", namespaces=namespace), "https://damianvdb.github.io/")

    def test_github_contribution_snapshot(self):
        snapshot = json.loads((ROOT / "data/github-contributions.json").read_text())
        self.assertEqual(snapshot["login"], "DamianvdB")
        self.assertEqual(len(snapshot["weeks"]), 52)
        days = [day for week in snapshot["weeks"] for day in week["days"]]
        self.assertEqual(len(days), 364)
        self.assertEqual(snapshot["totalContributions"], sum(day["count"] for day in days))
        self.assertEqual(len([attrs for attrs in DOC.tags("span") if "contribution-day" in attrs.get("class", "").split()]), 364)
        displayed_total = re.search(r'<strong data-github-contribution-total>([\d,]+)</strong>', HTML)[1]
        self.assertEqual(int(displayed_total.replace(",", "")), snapshot["totalContributions"])
        updater = (ROOT / "scripts/update-github-contributions.mjs").read_text()
        self.assertIn("process.env.GITHUB_TOKEN", updater)
        self.assertNotRegex(updater, r"gh[opsu]_[A-Za-z0-9]{20,}")
        workflow = (ROOT / ".github/workflows/pages.yml").read_text()
        self.assertIn("schedule:", workflow)
        self.assertIn("actions/deploy-pages@v4", workflow)
        modified = snapshot["generatedAt"][:10]
        profile = json.loads(re.search(r'<script type="application/ld\+json">(.+?)</script>', HTML, re.S)[1])
        self.assertEqual(profile["dateModified"], modified)
        sitemap = ET.parse(ROOT / "sitemap.xml").getroot()
        namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(sitemap.findtext("s:url/s:lastmod", namespaces=namespace), modified)

    def test_github_contribution_fixtures(self):
        result = subprocess.run(
            ["node", str(ROOT / "tests/github-contributions.mjs")],
            capture_output=True,
            text=True
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS GitHub contribution calendar fixtures for every weekday.", result.stdout)

    def test_links(self):
        ids = [a["id"] for _, a in DOC.elements if "id" in a]
        self.assertEqual(len(ids), len(set(ids)), "Duplicate IDs")
        for a in DOC.tags("a"):
            href = a["href"]
            if href.startswith("#"):
                self.assertIn(href[1:], ids)
            elif href.startswith("mailto:"):
                self.assertRegex(href, r"^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$")
            else:
                self.assertEqual(urlsplit(href).scheme, "https")
                if a.get("target") == "_blank":
                    self.assertTrue({"noopener", "noreferrer"} <= set(a.get("rel", "").split()))
        links = {a["href"] for a in DOC.tags("a")}
        for url in ("https://www.gethomely.io/", "https://github.com/damianvdb",
                    "https://www.linkedin.com/in/damian-van-den-berg/",
                    "https://play.google.com/store/apps/dev?id=5495749892977154499",
                    "https://medium.com/@vdberg.damian"):
            self.assertIn(url, links)

    def test_images_and_assets(self):
        assets = set()
        for tag, attrs in DOC.elements:
            for attribute in ("src", "href"):
                value = attrs.get(attribute, "")
                if value and not value.startswith(("#", "https:", "mailto:")):
                    assets.add(value)
            if "srcset" in attrs:
                assets.update(candidate.strip().split()[0] for candidate in attrs["srcset"].split(","))
            if tag == "img":
                self.assertIn("alt", attrs)
                self.assertGreater(int(attrs["width"]), 0)
                self.assertGreater(int(attrs["height"]), 0)
        assets.add("images/social-preview.jpg")
        manifest = json.loads((ROOT / "site.webmanifest").read_text())
        assets.update(icon["src"] for icon in manifest["icons"])
        for asset in assets:
            self.assertTrue((ROOT / asset).is_file(), asset)

    def test_responsive_portrait_formats(self):
        sources = DOC.tags("source")
        self.assertEqual([source.get("type") for source in sources], ["image/avif", "image/webp"])
        for source, extension in zip(sources, ("avif", "webp")):
            self.assertEqual(source["srcset"], f"images/portrait-480.{extension} 480w, images/portrait-960.{extension} 960w")
            self.assertIn("sizes", source)
        for size in (480, 960):
            self.assertIn(b"ftypavif", (ROOT / f"images/portrait-{size}.avif").read_bytes()[:64])
        portrait, = [img for img in DOC.tags("img") if "fetchpriority" in img]
        self.assertEqual(portrait["srcset"], "images/portrait-480.jpg 480w, images/portrait-960.jpg 960w")

    def test_javascript_syntax(self):
        for script in ("theme.js", "script.js", "scripts/github-contributions-lib.mjs",
                       "scripts/update-github-contributions.mjs", "tests/github-contributions.mjs",
                       "tests/browser.cjs"):
            result = subprocess.run(["node", "--check", str(ROOT / script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_motion_and_canvas_accessibility(self):
        canvas, = DOC.tags("canvas")
        self.assertEqual(canvas.get("aria-hidden"), "true")
        css = (ROOT / "styles.css").read_text()
        js = (ROOT / "script.js").read_text()
        self.assertIn("prefers-reduced-motion: reduce", css)
        self.assertIn(":focus-visible", css)
        self.assertIn("reduceMotion.matches", js)
        self.assertIn("Africa/Johannesburg", js)


if __name__ == "__main__":
    unittest.main(verbosity=2)

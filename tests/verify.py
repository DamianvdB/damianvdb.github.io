"""Dependency-free checks for the public page. Run with python3 tests/verify.py."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, urljoin
import json
import re
import subprocess
import struct
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text()
CANONICAL_ORIGIN = "https://damianvandenberg.com"


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
        personal_copy = ("When I’m not building software, I’m usually somewhere on a mountain with my dog. "
                         "At work, give me a tricky problem and a quiet afternoon to chase it down.")
        for text in ("Software engineer and technical", "co-founder", "Property made simple.",
                     "Principal Android Engineer", "5M+ installs", "4.6 ★",
                     "500K+ installs", "4.5 ★", "10M+ installs", "4.7 ★", "Redstor",
                     "BSc Computer Science", "cum laude", "Cape Town", personal_copy):
            self.assertIn(text, HTML)
        self.assertEqual(len(DOC.tags("article")), 4)
        for emoji in ("👇", "👋", "📱", "⚙️", "💡", "✨"):
            self.assertIn(emoji, HTML)
        for stale in ("Porfolio", "Senior Android", "17k", "com.redstor.client",
                      "GitHub, lately.", "contributions during the past year",
                      ">/in/damian-van-den-berg<"):
            self.assertNotIn(stale, HTML)
        linkedin = re.search(r'<a href="https://www\.linkedin\.com/in/damian-van-den-berg/"[^>]*>(.*?)</a>', HTML, re.S)
        self.assertIsNotNone(linkedin)
        self.assertEqual(re.sub(r'<[^>]+>', '', linkedin[1]).strip(), "LinkedIn")
        footer = re.search(r'<footer class="site-footer wrap">(.*?)</footer>', HTML, re.S)
        self.assertIsNotNone(footer)
        self.assertNotIn("↗", footer[1])

    def test_metadata_and_person(self):
        metas = {a.get("name", a.get("property")): a.get("content") for a in DOC.tags("meta")}
        for key in ("description", "og:title", "og:description", "og:url", "og:image",
                    "og:image:alt", "twitter:card", "twitter:image", "theme-color", "color-scheme"):
            self.assertTrue(metas.get(key), key)
        self.assertEqual(metas["twitter:card"], "summary_large_image")
        canonical = [a["href"] for a in DOC.tags("link") if a.get("rel") == "canonical"]
        self.assertEqual(canonical, [f"{CANONICAL_ORIGIN}/"])
        profile = json.loads(re.search(r'<script type="application/ld\+json">(.+?)</script>', HTML, re.S)[1])
        self.assertEqual(profile["@type"], "ProfilePage")
        self.assertEqual(profile["url"], f"{CANONICAL_ORIGIN}/")
        person = profile["mainEntity"]
        self.assertEqual(person["@type"], "Person")
        self.assertEqual(person["name"], "Damian van den Berg")
        self.assertEqual(person["alternateName"], "DamianvdB")
        self.assertEqual(person["@id"], f"{CANONICAL_ORIGIN}/#damian")
        self.assertEqual(person["url"], f"{CANONICAL_ORIGIN}/")
        self.assertEqual(person["image"], f"{CANONICAL_ORIGIN}/images/portrait-960.jpg")
        self.assertEqual(metas["og:url"], f"{CANONICAL_ORIGIN}/")
        self.assertEqual(metas["og:image"], f"{CANONICAL_ORIGIN}/images/social-preview.jpg")
        self.assertEqual(metas["twitter:image"], f"{CANONICAL_ORIGIN}/images/social-preview.jpg")
        self.assertNotIn("damianvdb.github.io", HTML)
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
        self.assertIn(f"Sitemap: {CANONICAL_ORIGIN}/sitemap.xml", robots)
        sitemap = ET.parse(ROOT / "sitemap.xml").getroot()
        namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        self.assertEqual(sitemap.findtext("s:url/s:loc", namespaces=namespace), f"{CANONICAL_ORIGIN}/")

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
        self.assertIn('src="images/homely.svg"', HTML)
        logo = ET.parse(ROOT / "images/homely.svg").getroot()
        namespace = {"svg": "http://www.w3.org/2000/svg"}
        self.assertEqual(logo.attrib["viewBox"], "0 33 134 134")
        self.assertEqual(logo.find(".//svg:rect", namespace).attrib["fill"], "#073A39")
        mark = logo.find(".//svg:path", namespace)
        self.assertEqual(mark.attrib["fill"], "#ABFF02")
        self.assertTrue(mark.attrib["d"].startswith("M603.302 383.203L597.648 377.549"))

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
        for script in ("theme.js", "script.js", "tests/browser.cjs"):
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
        self.assertIn("availableRadius / maxOrbit", js)
        self.assertIn("width: 100vw", css)


class DNotesChecks(unittest.TestCase):
    routes = ("d-notes/", "d-notes/privacy/", "d-notes/terms/")

    def documents(self):
        for route in self.routes:
            source = (ROOT / route / "index.html").read_text()
            yield route, source, Document(source)

    def test_routes_landmarks_and_links(self):
        for route, source, doc in self.documents():
            with self.subTest(route=route):
                self.assertEqual(doc.tags("html")[0]["lang"], "en")
                for tag in ("header", "main", "footer", "h1"):
                    self.assertEqual(len(doc.tags(tag)), 1, tag)
                self.assertEqual(doc.headings[0], 1)
                self.assertTrue(all(b <= a + 1 for a, b in zip(doc.headings, doc.headings[1:])))
                ids = [a["id"] for _, a in doc.elements if "id" in a]
                self.assertEqual(len(ids), len(set(ids)))
                self.assertIn('href="#main"', source)
                for nav in doc.tags("nav"):
                    self.assertTrue(nav.get("aria-label"))
                for section in doc.tags("section"):
                    self.assertIn(section.get("aria-labelledby"), ids)
                resolved = set()
                for link in doc.tags("a"):
                    href = link["href"]
                    if href.startswith("#"):
                        self.assertIn(href[1:], ids)
                    absolute = urljoin(CANONICAL_ORIGIN + "/" + route, href)
                    resolved.add(absolute)
                    if href.startswith("mailto:"):
                        self.assertEqual(href, "mailto:dvdb.software@gmail.com")
                        continue
                    self.assertEqual(urlsplit(absolute).scheme, "https")
                    if urlsplit(absolute).netloc == urlsplit(CANONICAL_ORIGIN).netloc:
                        target = ROOT / urlsplit(absolute).path.lstrip("/")
                        self.assertTrue((target / "index.html").is_file() if target.is_dir() else target.is_file(), href)
                    if link.get("target") == "_blank":
                        self.assertTrue({"noopener", "noreferrer"} <= set(link.get("rel", "").split()))
                self.assertIn("mailto:dvdb.software@gmail.com", resolved)
                for legal in self.routes[1:]:
                    self.assertIn(CANONICAL_ORIGIN + "/" + legal, resolved)

    def test_metadata_and_structured_data(self):
        for route, source, doc in self.documents():
            with self.subTest(route=route):
                canonical = [a["href"] for a in doc.tags("link") if a.get("rel") == "canonical"]
                self.assertEqual(canonical, [CANONICAL_ORIGIN + "/" + route])
                metas = {a.get("name", a.get("property")): a.get("content") for a in doc.tags("meta")}
                for name in ("description", "viewport", "color-scheme"):
                    self.assertTrue(metas.get(name))
                self.assertEqual(len(doc.tags("title")), 1)
                if route == "d-notes/":
                    for name in ("og:title", "og:description", "og:type", "og:url", "og:image", "og:image:alt", "twitter:card", "twitter:image", "twitter:image:alt"):
                        self.assertTrue(metas.get(name), name)
                    self.assertEqual(metas["og:url"], canonical[0])
                    application = json.loads(re.search(r'<script type="application/ld\+json">(.+?)</script>', source, re.S)[1])
                    self.assertEqual(application["@type"], "SoftwareApplication")
                    self.assertEqual(application["name"], "D Notes")
                    self.assertEqual(application["operatingSystem"], "Android")
                    self.assertEqual(application["url"], canonical[0])
                    self.assertEqual(application["downloadUrl"], "https://play.google.com/store/apps/details?id=com.dvdb.bergnotes")
                    self.assertEqual(application["image"], metas["og:image"])
                    self.assertTrue((ROOT / urlsplit(metas["og:image"]).path.lstrip("/")).is_file())
        self.assertIn('href="https://damianvandenberg.com/d-notes/"', HTML)
        profile = json.loads(re.search(r'<script type="application/ld\+json">(.+?)</script>', HTML, re.S)[1])
        self.assertNotIn("SoftwareApplication", json.dumps(profile))
        self.assertNotIn("d-notes/", json.dumps(profile))

    def test_assets_https_and_no_tracking(self):
        for route, source, doc in self.documents():
            with self.subTest(route=route):
                self.assertNotRegex(source, r"http://|//www\.googletagmanager|gtag\(|google-analytics|G-9W9T91DGRW")
                for script in doc.tags("script"):
                    self.assertEqual(script.get("type"), "application/ld+json")
                    self.assertNotIn("src", script)
                for tag, attrs in doc.elements:
                    for attr in ("src", "href"):
                        reference = attrs.get(attr, "")
                        if not reference or reference.startswith(("#", "mailto:")):
                            continue
                        absolute = urljoin(CANONICAL_ORIGIN + "/" + route, reference)
                        self.assertEqual(urlsplit(absolute).scheme, "https")
                        if urlsplit(absolute).netloc != urlsplit(CANONICAL_ORIGIN).netloc:
                            continue
                        asset = ROOT / urlsplit(absolute).path.lstrip("/")
                        self.assertTrue(asset.exists(), reference)
                        if tag == "img" and attr == "src":
                            self.assertIn("alt", attrs)
                            data = asset.read_bytes()
                            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                            self.assertEqual(struct.unpack(">II", data[16:24]), (int(attrs["width"]), int(attrs["height"])))
        css = (ROOT / "d-notes/styles.css").read_text()
        self.assertNotIn("@import", css)
        self.assertNotIn("url(", css)
        for requirement in ("prefers-color-scheme: dark", "prefers-reduced-motion: reduce", ":focus-visible", "#F44336"):
            self.assertIn(requirement, css)

    def test_copy_and_legal_requirements(self):
        homepage = (ROOT / "d-notes/index.html").read_text()
        text = re.sub(r"<[^>]+>", "", homepage)
        self.assertIn("Notes, lists, and the odd brilliant idea.", text)
        self.assertIn("D Notes is a colourful Android notebook for thoughts, reminders, photos, recordings, and everything you swear you’ll remember later.", text)
        self.assertIn("Get D Notes on Google Play", text)
        for term in ("checklist", "reminder", "photos", "files", "PIN", "fingerprint", "fonts", "Google Drive", "restore", "sync", "Android system backup"):
            self.assertIn(term, text)
        self.assertIn("Your notebook is stored on your device. Backup, sync, and sharing are optional, and Android system backup follows your device settings.", text)
        self.assertIn("The app uses Firebase Analytics and crash reporting to help improve reliability.", text)
        self.assertNotIn("Your notes stay on your device unless", text)
        for route, source, doc in self.documents():
            if route == "d-notes/":
                continue
            self.assertIn('datetime="2026-10-04"', source)
            self.assertIn("Back to D Notes", source)
            self.assertEqual(doc.tags("html")[0]["class"], "legal-page")
            content = re.search(r"<main\b[^>]*>(.*?)</main>", source, re.S)[1]
            words = re.sub(r"<[^>]+>", " ", content).split()
            self.assertLess(len(words), 700 if "privacy" in route else 450)
        privacy = (ROOT / "d-notes/privacy/index.html").read_text()
        for term in ("drive.file", "drive.appdata", "email", "Firebase Analytics", "Crashlytics", "filenames", "Google Play", "retention", "uninstall", "Revoking", "Limited Use", "do not sell"):
            self.assertIn(term, privacy)
        terms = (ROOT / "d-notes/terms/index.html").read_text()
        for term in ("South African law", "refund", "backups", "Google Drive", "liability", "uninterrupted"):
            self.assertIn(term, terms)

    def test_sitemap_routes_and_dates(self):
        sitemap = ET.parse(ROOT / "sitemap.xml").getroot()
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        entries = {url.findtext("s:loc", namespaces=ns): url.findtext("s:lastmod", namespaces=ns) for url in sitemap}
        for route in ("", *self.routes):
            self.assertEqual(entries[CANONICAL_ORIGIN + "/" + route], "2026-10-04")


if __name__ == "__main__":
    unittest.main(verbosity=2)

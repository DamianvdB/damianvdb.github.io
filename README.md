# Damian's profile

A responsive, zero-build personal website for GitHub Pages. The HTML, CSS, and
JavaScript are served directly, with no framework, font service, or runtime dependency.

## Local preview

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173.

## Verification

```sh
python3 tests/verify.py
```

The dependency-free checks require Python 3 and Node.js. They verify key content,
landmarks, heading order, metadata, structured data, links, image dimensions,
asset references, and JavaScript syntax.

For browser verification, install Playwright outside the website or use an existing
installation, then run against the local server:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/browser.cjs
```

The browser check uses Chromium and checks responsive overflow, image loading,
keyboard navigation, themes and persistence, system changes, reduced motion,
disabled storage, disabled JavaScript, and browser errors. Screenshots and traces
stay in the ignored `.superpowers/sdd/website-profile-plan/evidence/` directory.
Set `BASE_URL` or `EVIDENCE_DIR` to override the defaults.

## Maintenance

- Edit `index.html` for content and links. The ClearScore timeline starts at the
  company joining year, not the year the current title was obtained.
- The theme control cycles through system, light, and dark. Without JavaScript,
  the page follows the system preference and all content remains available.
- The Canvas network is decorative. It becomes still with reduced motion and
  stops animating when the hero is offscreen or the document is hidden.
- Portraits are resized derivatives of Damian's supplied photo, with WebP sources
  and JPEG fallbacks. Icons and the 1200 × 630 social preview are committed assets.
- Keep the canonical and social URLs in sync if a custom domain is added.
- Work-card illustrations are decorative interpretations, not product screenshots.

// Optional browser smoke test; Playwright is a development tool, not a site dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const evidence = path.resolve(process.env.EVIDENCE_DIR || '.superpowers/sdd/website-profile-plan/evidence');
fs.mkdirSync(evidence, { recursive: true });

class ProfilePage {
  constructor(page) {
    this.page = page;
    this.theme = page.getByRole('button', { name: /^Theme:/ });
  }
  async open() {
    await this.page.goto(base);
    await this.page.getByRole('heading', { level: 1 }).waitFor();
    await this.page.evaluate(() => document.fonts.ready);
  }
  async capture(name) {
    // Reveal each section naturally before taking a complete page screenshot.
    for (const heading of await this.page.getByRole('heading', { level: 2 }).all()) {
      await heading.scrollIntoViewIfNeeded();
    }
    await this.page.evaluate(() => {
      document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await this.page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true, animations: 'disabled' });
    await this.page.screenshot({ path: path.join(evidence, name + '-viewport.png'), animations: 'disabled' });
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  async function scenario(name, options, check) {
    const context = await browser.newContext(options);
    await context.addInitScript(() => {
      window.__layoutShift = 0;
      window.__layoutShiftEntries = [];
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__layoutShift += entry.value;
            window.__layoutShiftEntries.push({
              value: entry.value,
              sources: entry.sources.map(source => ({
                element: source.node?.nodeName,
                className: source.node?.className,
                previous: source.previousRect.toJSON(),
                current: source.currentRect.toJSON()
              }))
            });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(name + ': ' + error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(name + ': ' + message.text()); });
    page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(base)) errors.push(name + ': HTTP ' + response.status()); });
    try {
      await check(new ProfilePage(page), context);
      console.log('PASS ' + name);
    } finally {
      await context.tracing.stop({ path: path.join(evidence, name + '-trace.zip') });
      await context.close();
    }
  }
  try {
    const results = await Promise.allSettled([
      scenario('desktop-light', { viewport: { width: 1440, height: 1000 }, colorScheme: 'light' }, async profile => {
        await profile.open();
        const page = profile.page;
        await page.keyboard.press('Tab');
        assert.equal(await page.getByRole('link', { name: 'Skip to content' }).evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
        assert.match(await page.locator('time').textContent(), /^\d{2}:\d{2}$/);
        assert.equal(await page.getByRole('article').count(), 4);
        // Lazy images are checked after the full-page capture has scrolled through them.
        await profile.capture('desktop-light');
        assert.deepEqual(await page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src'))), []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const shortTargets = await page.locator('a, button').evaluateAll(elements => elements.filter(el => {
          if (el.hidden || el.classList.contains('skip-link')) return false;
          const rect = el.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44;
        }).map(el => el.textContent.trim()));
        assert.deepEqual(shortTargets, []);
      }),
      scenario('themes', { viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', reducedMotion: 'reduce' }, async profile => {
        await profile.open();
        const page = profile.page;
        const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.equal(await background(), 'rgb(16, 37, 31)');
        await profile.theme.click();
        assert.equal(await background(), 'rgb(246, 245, 239)');
        await page.reload();
        assert.match(await profile.theme.getAttribute('aria-label'), /^Theme: light/);
        await profile.theme.click();
        assert.equal(await background(), 'rgb(16, 37, 31)');
        await page.reload();
        assert.match(await profile.theme.getAttribute('aria-label'), /^Theme: dark/);
        await profile.capture('desktop-dark');
        await profile.theme.click();
        assert.equal(await page.evaluate(() => localStorage.getItem('theme')), null);
        await page.emulateMedia({ colorScheme: 'light' });
        assert.equal(await background(), 'rgb(246, 245, 239)');
        await page.emulateMedia({ colorScheme: 'dark' });
        assert.equal(await background(), 'rgb(16, 37, 31)');
        await page.waitForFunction(() => document.querySelector('meta[name="theme-color"]').content === '#10251f');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const still = await page.locator('canvas').evaluate(canvas => canvas.toDataURL());
        await page.getByRole('link', { name: 'Explore my work' }).hover();
        assert.ok(await page.locator('canvas').evaluate(canvas => canvas.toDataURL()) === still, 'Reduced-motion Canvas remains unchanged');
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
        assert.deepEqual(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').map(animation => animation.id)), []);
      }),
      ...[320, 390, 768].map(width => scenario('responsive-' + width, { viewport: { width, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce', deviceScaleFactor: 1 }, async profile => {
        await profile.open();
        await profile.capture('responsive-' + width);
        assert.equal(await profile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const layoutShift = await profile.page.evaluate(() => window.__layoutShift);
        if (layoutShift) console.log(width, await profile.page.evaluate(() => window.__layoutShiftEntries));
        assert.equal(layoutShift, 0, 'No unexpected layout shifts');
        assert.deepEqual(await profile.page.locator('img').evaluateAll(images => images.filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src'))), []);
        await profile.page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About' }).click();
        assert.equal(new URL(profile.page.url()).hash, '#about');
      })),
      scenario('no-javascript', { viewport: { width: 390, height: 844 }, javaScriptEnabled: false, colorScheme: 'dark' }, async profile => {
        await profile.open();
        assert.equal(await profile.page.getByRole('article').count(), 4);
        assert.equal(await profile.theme.count(), 0);
        await profile.page.getByRole('heading', { name: /Thoughtful work/ }).waitFor();
        await profile.capture('no-javascript');
      }),
      scenario('blocked-storage', { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }, async (profile, context) => {
        await context.addInitScript(() => {
          Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
        });
        await profile.open();
        await profile.theme.click();
        assert.match(await profile.theme.getAttribute('aria-label'), /^Theme: light/);
        await profile.theme.click();
        assert.match(await profile.theme.getAttribute('aria-label'), /^Theme: dark/);
      })
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    for (const failure of failures) console.error(failure.reason);
    assert.equal(failures.length, 0, 'Browser scenario failures');
    assert.deepEqual(errors, [], 'Browser errors');
    console.log('PASS 7 browser scenarios; no local resource, console, or uncaught JavaScript errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

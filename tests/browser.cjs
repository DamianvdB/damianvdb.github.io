// Optional browser smoke test; Playwright is a development tool, not a site dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const evidence = path.resolve(process.env.EVIDENCE_DIR || '.superpowers/sdd/website-profile-plan/evidence');
const filter = process.env.SCENARIOS?.split(',');
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
    if (filter && !filter.includes(name)) return;
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
        assert.match(await page.getByRole('img', { name: /Damian van den Berg smiling/ }).evaluate(async img => {
          await img.decode();
          return img.currentSrc;
        }), /portrait-(480|960)\.avif$/);
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
        await page.getByRole('link', { name: 'See what I’ve built' }).hover();
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
        await profile.page.getByRole('heading', { name: /I build things/ }).waitFor();
        await profile.capture('no-javascript');
      }),
      scenario('network-interaction', { viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'no-preference' }, async (profile, context) => {
        // Hold animation time constant so pixel changes prove input response, not ambient drift.
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8 });
          Object.defineProperty(navigator, 'deviceMemory', { value: 8 });
          Object.defineProperty(navigator, 'connection', { value: { saveData: false } });
          const requestFrame = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = callback => requestFrame(() => callback(1000));
          window.__networkDraws = 0;
          const clear = CanvasRenderingContext2D.prototype.clearRect;
          CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (this.canvas.id === 'hero-network') window.__networkDraws += 1;
            return clear.apply(this, args);
          };
        });
        await profile.open();
        const page = profile.page;
        const canvas = page.locator('canvas');
        const pixels = () => canvas.evaluate(element => element.toDataURL());
        const frames = () => page.evaluate(async () => {
          for (let frame = 0; frame < 4; frame++) await new Promise(requestAnimationFrame);
        });
        await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
        await frames();
        const initial = await pixels();
        await page.mouse.move(1120, 360);
        await frames();
        assert.ok(await pixels() !== initial, 'Pointer movement changes the network with animation time fixed');
        await page.screenshot({ path: path.join(evidence, 'network-pointer.png'), animations: 'disabled' });
        await page.mouse.move(10, 10);
        await frames();
        const beforeScroll = await pixels();
        await page.evaluate(() => window.scrollTo({ top: 160, behavior: 'instant' }));
        await frames();
        assert.ok(await pixels() !== beforeScroll, 'Scrolling changes the network with animation time fixed');
        await page.screenshot({ path: path.join(evidence, 'network-scroll.png'), animations: 'disabled' });
        assert.equal(await canvas.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
        await page.getByRole('link', { name: 'See what I’ve built' }).click();
        assert.equal(new URL(page.url()).hash, '#work', 'Hero link remains clickable through the decoration');
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
        await frames();
        const offscreenDraws = await page.evaluate(() => window.__networkDraws);
        await frames();
        assert.equal(await page.evaluate(() => window.__networkDraws), offscreenDraws, 'Offscreen network stays paused');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await frames();
        const still = await pixels();
        await page.mouse.move(1120, 360);
        await page.evaluate(() => window.scrollTo({ top: 160, behavior: 'instant' }));
        await frames();
        assert.ok(await pixels() === still, 'Reduced motion ignores pointer and scroll input');
      }),
      scenario('constrained-network', { viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', reducedMotion: 'no-preference' }, async (profile, context) => {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2 });
          Object.defineProperty(navigator, 'deviceMemory', { value: 1 });
          Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
          window.__networkDraws = 0;
          const clear = CanvasRenderingContext2D.prototype.clearRect;
          CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            if (this.canvas.id === 'hero-network') window.__networkDraws += 1;
            return clear.apply(this, args);
          };
        });
        await profile.open();
        const page = profile.page;
        const canvas = page.locator('canvas');
        const frames = () => page.evaluate(async () => {
          for (let frame = 0; frame < 8; frame++) await new Promise(requestAnimationFrame);
        });
        await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
        await frames();
        const before = await page.evaluate(() => window.__networkDraws);
        assert.ok(before > 0, 'Constrained device retains a rendered decoration');
        const pixels = await canvas.evaluate(element => element.toDataURL());
        await page.mouse.move(1120, 360);
        await page.evaluate(() => window.scrollTo({ top: 160, behavior: 'instant' }));
        await frames();
        assert.equal(await page.evaluate(() => window.__networkDraws), before, 'Constrained device does not continuously redraw or paint on input');
        assert.ok(await canvas.evaluate(element => element.toDataURL()) === pixels, 'Constrained network ignores pointer and scroll motion');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await frames();
        await page.screenshot({ path: path.join(evidence, 'constrained-network.png'), animations: 'disabled' });
        await profile.theme.click();
        assert.match(await profile.theme.getAttribute('aria-label'), /^Theme: light/);
        await frames();
        const themeDraws = await page.evaluate(() => window.__networkDraws);
        assert.ok(themeDraws > before, 'Static network repaints when theme changes');
        await frames();
        assert.equal(await page.evaluate(() => window.__networkDraws), themeDraws, 'Theme repaint does not restart animation');
      }),
      scenario('homely-focus', { viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }, async profile => {
        await profile.open();
        const page = profile.page;
        const link = page.getByRole('link', { name: 'Discover homely' });
        for (const colorScheme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme });
          await link.focus();
          assert.ok(await link.evaluate(element => element.matches(':focus-visible')), 'Focus indicator is visible');
          const contrast = await link.evaluate(element => {
            const style = getComputedStyle(element);
            const card = getComputedStyle(element.closest('article'));
            const luminance = color => {
              const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
                value /= 255;
                return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
              });
              return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
            };
            const outline = luminance(style.outlineColor);
            const background = luminance(card.backgroundColor);
            return { ratio: (Math.max(outline, background) + .05) / (Math.min(outline, background) + .05), width: parseFloat(style.outlineWidth) };
          });
          assert.ok(contrast.width >= 3, 'Focus outline stays at least 3px wide');
          assert.ok(contrast.ratio >= 3, colorScheme + ' homely focus contrast must be at least 3:1; got ' + contrast.ratio.toFixed(2));
          console.log('homely focus contrast (' + colorScheme + '): ' + contrast.ratio.toFixed(2) + ':1');
          await page.screenshot({ path: path.join(evidence, 'homely-focus-' + colorScheme + '.png'), animations: 'disabled' });
        }
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
    console.log('PASS ' + (filter ? filter.length : 10) + ' browser scenarios; no local resource, console, or uncaught JavaScript errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

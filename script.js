(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const toggle = document.getElementById('theme-toggle');
  const modes = ['system', 'light', 'dark'];
  let mode = root.dataset.theme || 'system';
  let repaintNetwork = () => {};

  function updateTheme() {
    if (mode === 'system') delete root.dataset.theme;
    else root.dataset.theme = mode;
    const next = modes[(modes.indexOf(mode) + 1) % modes.length];
    toggle.setAttribute('aria-label', `Theme: ${mode}. Switch to ${next} theme.`);
    document.getElementById('theme-label').textContent = mode[0].toUpperCase() + mode.slice(1);
    const dark = mode === 'dark' || (mode === 'system' && systemTheme.matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      meta.content = dark ? '#10251f' : '#f6f5ef';
    });
    repaintNetwork();
  }

  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    try {
      if (mode === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', mode);
    } catch { /* Theme controls still work without persistent storage. */ }
    updateTheme();
  });
  systemTheme.addEventListener('change', updateTheme);
  updateTheme();

  const clock = document.getElementById('cape-town-clock');
  const clockFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false
  });
  function updateClock() {
    const now = new Date();
    const time = clockFormat.format(now);
    clock.textContent = time;
    clock.dateTime = now.toISOString();
    clock.setAttribute('aria-label', `Cape Town time: ${time}`);
    document.getElementById('year').textContent = now.getFullYear();
  }
  updateClock();
  setInterval(updateClock, 30000);

  // Content is visible by default, even without JavaScript or an observer.
  if ('IntersectionObserver' in window) {
    const reveals = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!reduceMotion.matches) entry.target.classList.add('is-visible');
          reveals.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(section => reveals.observe(section));
  }

  const canvas = document.getElementById('hero-network');
  const context = canvas.getContext('2d');
  if (!context) return;
  const scene = document.querySelector('.portrait-scene');
  let width = 0;
  let height = 0;
  let frame = 0;
  let visible = true;
  let ink;
  let center = { x: 0, y: 0, radius: 0 };
  const nodes = Array.from({ length: 22 }, (_, index) => ({
    angle: index * Math.PI * 2 / 22,
    orbit: 1.08 + (index % 3) * 0.12,
    phase: index * 1.9
  }));

  function draw(time = 0) {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = ink;
    context.fillStyle = ink;
    const points = nodes.map(node => {
      const drift = reduceMotion.matches ? 0 : Math.sin(time / 7000 + node.phase) * 6;
      return {
        x: center.x + Math.cos(node.angle) * (center.radius * node.orbit + drift),
        y: center.y + Math.sin(node.angle) * (center.radius * node.orbit + drift)
      };
    });
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      context.globalAlpha = .20;
      context.lineWidth = .8;
      context.beginPath();
      context.moveTo(point.x, point.y);
      context.lineTo(next.x, next.y);
      if (index % 2 === 0) {
        const across = points[(index + 5) % points.length];
        context.lineTo(across.x, across.y);
      }
      context.stroke();
      context.globalAlpha = .4;
      context.beginPath();
      context.arc(point.x, point.y, index % 3 === 0 ? 2.5 : 1.5, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
    if (!reduceMotion.matches && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }

  function render() {
    cancelAnimationFrame(frame);
    ink = getComputedStyle(root).getPropertyValue('--emerald').trim();
    draw(performance.now());
  }
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = bounds.width;
    height = bounds.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    center = {
      x: scene.offsetLeft + scene.offsetWidth / 2,
      y: scene.offsetTop + scene.offsetHeight / 2,
      radius: scene.offsetWidth * .45
    };
    render();
  }
  repaintNetwork = render;
  reduceMotion.addEventListener('change', render);
  document.addEventListener('visibilitychange', render);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      render();
    }).observe(canvas);
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  resize();
})();

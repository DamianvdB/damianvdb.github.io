// Apply a saved preference before styles paint. System mode stays responsive to OS changes.
(() => {
  try {
    const preference = localStorage.getItem('theme');
    if (preference === 'light' || preference === 'dark') {
      document.documentElement.dataset.theme = preference;
    }
  } catch {
    // Storage can be unavailable in private or restricted browsing.
  }
})();

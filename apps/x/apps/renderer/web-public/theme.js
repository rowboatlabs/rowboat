// The theme class before first paint, as the desktop's index.html does
// inline. A file, not an inline script, so the page's CSP can forbid inline
// script outright (vercel.json).
(function () {
  var stored = localStorage.getItem('rowboat-theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = stored || 'system';
  var resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.classList.add(resolved);
})();

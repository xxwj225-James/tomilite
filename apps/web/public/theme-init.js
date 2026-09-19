// Apply saved theme + light/dark mode before React renders — avoids a flash of
// the wrong theme. Runs synchronously in <head>, ahead of the module bundle.
// Always writes both attributes so the HTML defaults never leak through.
(function() {
  var root = document.documentElement;
  root.setAttribute('data-theme', localStorage.getItem('tomilite-theme') || 'pipeline');
  root.setAttribute('data-mode', localStorage.getItem('tomilite-mode') === 'dark' ? 'dark' : 'light');
})();

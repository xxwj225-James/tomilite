// Apply saved theme before React renders — avoids flash of wrong theme
(function() {
  var theme = localStorage.getItem('tomilite-theme');
  if (theme) document.documentElement.setAttribute('data-theme', theme);
})();

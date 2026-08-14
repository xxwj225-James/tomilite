// Global error handler for fatal startup errors
window.onerror = function(m, s, l, c, e) {
  var d = document.getElementById('fatal-error');
  d.style.display = 'block';
  d.textContent = 'FATAL: ' + m + '\n' + s + ':' + l + '\n' + ((e && e.stack) || '');
};
window.onunhandledrejection = function(e) {
  var d = document.getElementById('fatal-error');
  d.style.display = 'block';
  d.textContent = 'PROMISE: ' + e.reason + '\n' + (e.reason && e.reason.stack || '');
};
setTimeout(function() {
  var r = document.getElementById('root');
  if (r && !r.textContent.trim()) {
    var d = document.getElementById('fatal-error');
    d.style.display = 'block';
    d.textContent = 'STARTUP TIMEOUT: React did not render within 10 seconds. The JS bundle may have failed to load.';
  }
}, 10000);

(function () {
  'use strict';
  var done = false, failed = false, timer;
  var panel = document.getElementById('startup-panel');
  var message = document.getElementById('startup-message');
  var detail = document.getElementById('startup-detail');
  var retry = document.getElementById('startup-retry');
  function fail(error) {
    if (done) return;
    failed = true;
    clearTimeout(timer);
    panel.hidden = false;
    document.getElementById('startup-heading').textContent = 'The map has not opened';
    message.textContent = 'Try again, or open the interactive atlas using the browser link below. Some file previews cannot run an interactive map.';
    retry.hidden = false;
    var reason = error && (error.message || error);
    if (reason) {
      detail.textContent = String(reason).slice(0, 300);
      document.getElementById('startup-error').hidden = false;
    }
  }
  window.AtlasStartup = {
    ready: function () {
      done = true;
      clearTimeout(timer);
      document.body.classList.remove('atlas-pending');
      panel.hidden = true;
    },
    fail: fail
  };
  window.addEventListener('error', function (event) {
    if (event.target && event.target.tagName === 'SCRIPT') fail('A required map file could not be loaded.');
    else if (event.message) fail(event.error || event.message);
  }, true);
  window.addEventListener('unhandledrejection', function (event) { fail(event.reason); });
  retry.addEventListener('click', function () { window.location.reload(); });
  message.textContent = 'Loading the map and its source records…';
  timer = setTimeout(function () { if (!done && !failed) fail('Loading did not complete.'); }, 20000);
})();

/* global window, document, sessionStorage, location */
// Runs without the application bundle. A failed update may retry its compatible predecessor once.
(() => {
  setTimeout(() => {
    if (window.__DD_WORKSPACE_READY__) return;
    try {
      const key = 'dondocs-update-restore', point = JSON.parse(sessionStorage.getItem(key) || 'null');
      const id = document.querySelector('meta[name="dondocs-release"]')?.content;
      if (!point || point.schema !== 1 || point.dataFormat !== 1 || point.target !== id || point.retried
        || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(point.previous) || document.getElementById('main-content')) return;
      point.retried = true; sessionStorage.setItem(key, JSON.stringify(point));
      location.replace(`/releases/${point.previous}/index.html${location.search}${location.hash}`);
    } catch { /* Unavailable recovery storage leaves the current page intact. */ }
  }, 15000);
})();

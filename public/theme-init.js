chrome.storage.local.get('theme', function (r) {
  var p = r.theme || 'system';
  var dark =
    p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
});

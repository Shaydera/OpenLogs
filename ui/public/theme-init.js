// A classic script in <head>, so the stored theme is on the root before the first paint (a light theme
// would otherwise start dark). theme.ts applies the same rules afterwards; theme.test.ts keeps both in step.
(function () {
  function read(key, allowed, fallback) {
    try {
      var value = localStorage.getItem('openlogs.' + key);
      return allowed.indexOf(value) >= 0 ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }
  var theme = read('theme', ['slate', 'bark'], 'slate');
  var mode = read('themeMode', ['system', 'light', 'dark'], 'dark');
  if (mode === 'system') {
    var dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
    mode = dark ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.mode = mode;
})();

// Speaker page tab switcher (supports #plenary / #keynote / #invited / #committee deep links)
document.querySelectorAll('.tabs a').forEach(function (t) {
  t.addEventListener('click', function (e) {
    e.preventDefault();
    var key = t.dataset.tab;
    document.querySelectorAll('.tabs a').forEach(function (x) { x.classList.toggle('active', x === t); });
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + key); });
    history.replaceState(null, '', '#' + key);
  });
});
(function () {
  var h = location.hash.slice(1);
  if (!h) return;
  var t = document.querySelector('.tabs a[data-tab="' + h + '"]');
  if (t) t.click();
})();

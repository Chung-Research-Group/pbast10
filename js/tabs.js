// Accessible speaker tabs with keyboard navigation and deep links.
(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  if (!tabs.length) return;

  function activate(tab, focus) {
    var key = tab.dataset.tab;
    tabs.forEach(function (item) {
      var selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('[role="tabpanel"]').forEach(function (panel) {
      var selected = panel.id === 'tab-' + key;
      panel.classList.toggle('active', selected);
      panel.hidden = !selected;
    });
    history.replaceState(null, '', '#' + key);
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function (event) {
      event.preventDefault();
      activate(tab, false);
    });
    tab.addEventListener('keydown', function (event) {
      var next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[next], true);
    });
  });

  var hashTab = tabs.find(function (tab) { return tab.dataset.tab === location.hash.slice(1); });
  activate(hashTab || tabs[0], false);
})();

// Accessible mobile navigation shared by every page.
(function () {
  var button = document.querySelector('.nav-toggle');
  var navigation = document.querySelector('#primary-nav');
  if (!button || !navigation) return;

  function setOpen(open) {
    navigation.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  }

  button.addEventListener('click', function () {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  navigation.addEventListener('click', function (event) {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      setOpen(false);
      button.focus();
    }
  });
})();

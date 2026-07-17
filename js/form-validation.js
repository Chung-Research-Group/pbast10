// Leave a small margin for the other fields under Netlify's 8 MB request limit.
(function () {
  var form = document.querySelector('form[name="abstract-submission"]');
  var fileInput = document.querySelector('#abstract-file');
  var submissionId = document.querySelector('#submission-id');
  var netlifyName = document.querySelector('#netlify-name');
  if (!form || !fileInput) return;

  if (submissionId && !submissionId.value) {
    submissionId.value = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : 'pbast10-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  form.addEventListener('submit', function (event) {
    if (netlifyName) {
      var lastName = document.querySelector('#last-name').value.trim();
      var firstName = document.querySelector('#first-name').value.trim();
      netlifyName.value = lastName && firstName ? lastName + ', ' + firstName : lastName || firstName;
    }
    var file = fileInput.files[0];
    if (file && file.size > 7.5 * 1024 * 1024) {
      event.preventDefault();
      fileInput.setCustomValidity('Please upload a file no larger than 7.5 MB.');
      fileInput.reportValidity();
    }
  });

  fileInput.addEventListener('change', function () {
    fileInput.setCustomValidity('');
  });
})();

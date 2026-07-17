(function () {
  var loading = document.querySelector('#revision-loading');
  var errorBox = document.querySelector('#revision-error');
  var errorMessage = document.querySelector('#revision-error-message');
  var content = document.querySelector('#revision-content');
  var form = document.querySelector('form[name="abstract-revision"]');
  var fileInput = document.querySelector('#abstract-file');
  var token = new URLSearchParams(window.location.search).get('token') || '';

  function showError(message) {
    loading.hidden = true;
    content.hidden = true;
    errorMessage.textContent = message || 'This revision link is invalid or has expired.';
    errorBox.hidden = false;
  }

  function setValue(selector, value) {
    var field = document.querySelector(selector);
    if (field) field.value = value || '';
  }

  function makeId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : 'revision-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  if (!/^[a-f0-9]{64}$/i.test(token)) {
    showError('This revision link is invalid or incomplete. Please use the full link from your confirmation email.');
    return;
  }

  fetch('/.netlify/functions/abstract-revision-api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token })
  })
    .then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || body.ok !== true) throw new Error(body.error || 'The revision service is temporarily unavailable.');
        return body;
      });
    })
    .then(function (result) {
      var submission = result.submission || {};
      setValue('#submission-id', submission.submissionId);
      setValue('#revision-id', makeId());
      setValue('#edit-token', token);
      setValue('#last-name', submission.lastName);
      setValue('#first-name', submission.firstName);
      setValue('#email', submission.email);
      setValue('#affiliation', submission.affiliation);
      setValue('#country', submission.country);
      setValue('#presentation', submission.presentationPreference);
      setValue('#topic', submission.primaryTopic);
      setValue('#title', submission.abstractTitle);
      setValue('#authors', submission.coAuthors);

      document.querySelector('#submission-summary-id').textContent = submission.submissionId || '';
      document.querySelector('#revision-summary').textContent = result.revisionCount
        ? 'Revisions previously submitted: ' + result.revisionCount
        : 'No revisions have been submitted yet.';

      var fileLink = document.querySelector('#current-file-link');
      if (/^https:\/\//i.test(submission.currentFileUrl || '')) {
        fileLink.href = submission.currentFileUrl;
      } else {
        fileLink.hidden = true;
      }

      loading.hidden = true;
      content.hidden = false;
    })
    .catch(function (error) {
      showError(error.message);
    });

  form.addEventListener('submit', function (event) {
    var file = fileInput.files[0];
    if (file && file.size > 7.5 * 1024 * 1024) {
      event.preventDefault();
      fileInput.setCustomValidity('Please upload a file no larger than 7.5 MB.');
      fileInput.reportValidity();
      return;
    }
    document.querySelector('#revision-submit').textContent = 'Submitting…';
  });

  fileInput.addEventListener('change', function () {
    fileInput.setCustomValidity('');
  });
})();

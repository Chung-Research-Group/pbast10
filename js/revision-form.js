(function () {
  var loading = document.querySelector('#revision-loading');
  var errorBox = document.querySelector('#revision-error');
  var errorMessage = document.querySelector('#revision-error-message');
  var content = document.querySelector('#revision-content');
  var form = document.querySelector('form[name="abstract-revision"]');
  var fileInput = document.querySelector('#abstract-file');
  var hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  var queryParams = new URLSearchParams(window.location.search);
  // Fragment tokens are not sent to Netlify, Cloudflare, or other HTTP servers.
  // Keep query support temporarily so previously issued confirmation links still work.
  var token = hashParams.get('token') || queryParams.get('token') || '';

  if (token) {
    queryParams.delete('token');
    var cleanUrl = window.location.pathname + (queryParams.toString() ? '?' + queryParams.toString() : '');
    window.history.replaceState(null, document.title, cleanUrl);
  }

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

  function validatePdf(file) {
    if (!file) return '';
    if (!/\.pdf$/i.test(file.name || '') || (file.type && file.type !== 'application/pdf')) {
      return 'Please upload a PDF file.';
    }
    if (file.size > 7.5 * 1024 * 1024) {
      return 'Please upload a file no larger than 7.5 MB.';
    }
    return '';
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
      setValue('#netlify-name', (submission.lastName && submission.firstName)
        ? submission.lastName + ', ' + submission.firstName
        : submission.lastName || submission.firstName);
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
    var lastName = document.querySelector('#last-name').value.trim();
    var firstName = document.querySelector('#first-name').value.trim();
    setValue('#netlify-name', lastName && firstName ? lastName + ', ' + firstName : lastName || firstName);
    var validationMessage = validatePdf(fileInput.files[0]);
    if (validationMessage) {
      event.preventDefault();
      fileInput.setCustomValidity(validationMessage);
      fileInput.reportValidity();
      return;
    }
    document.querySelector('#revision-submit').textContent = 'Submitting…';
  });

  fileInput.addEventListener('change', function () {
    fileInput.setCustomValidity(validatePdf(fileInput.files[0]));
  });
})();

// Update the approximate KRW registration fees from the latest validated ECB data.
(function () {
  'use strict';

  var RATE_DATA_URL = 'data/exchange-rate.json';
  var rateFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var amountFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

  function isValidRateData(data) {
    return data &&
      data.baseCurrency === 'USD' &&
      data.quoteCurrency === 'KRW' &&
      Number.isFinite(data.rate) &&
      data.rate >= 500 && data.rate <= 3000 &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.effectiveDate) &&
      data.source === 'European Central Bank' &&
      typeof data.sourceUrl === 'string' &&
      data.sourceUrl.indexOf('https://www.ecb.europa.eu/') === 0;
  }

  function formatDate(isoDate) {
    return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    });
  }

  function applyRate(data) {
    document.querySelectorAll('[data-usd-fee]').forEach(function (cell) {
      var usdAmount = Number(cell.getAttribute('data-usd-fee'));
      var krwOutput = cell.querySelector('[data-krw-equivalent]');
      if (!Number.isFinite(usdAmount) || !krwOutput) return;

      var roundedKrw = Math.round((usdAmount * data.rate) / 1000) * 1000;
      krwOutput.textContent = '≈ KRW ' + amountFormatter.format(roundedKrw);
    });

    var rateOutput = document.querySelector('[data-exchange-rate]');
    var dateOutput = document.querySelector('[data-exchange-rate-date]');
    var sourceLink = document.querySelector('[data-exchange-rate-source]');

    if (rateOutput) rateOutput.textContent = 'USD 1 ≈ KRW ' + rateFormatter.format(data.rate);
    if (dateOutput) {
      dateOutput.dateTime = data.effectiveDate;
      dateOutput.textContent = formatDate(data.effectiveDate);
    }
    if (sourceLink) sourceLink.href = data.sourceUrl;
  }

  fetch(RATE_DATA_URL, { cache: 'no-cache' })
    .then(function (response) {
      if (!response.ok) throw new Error('Exchange-rate data request failed');
      return response.json();
    })
    .then(function (data) {
      if (!isValidRateData(data)) throw new Error('Exchange-rate data is invalid');
      applyRate(data);
    })
    .catch(function () {
      // Keep the validated static fallback already rendered in the HTML.
    });
})();

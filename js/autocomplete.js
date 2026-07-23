(function () {
  'use strict';

  var REGION_CODES = (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
    'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM ' +
    'JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ ' +
    'MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE ' +
    'RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT ' +
    'TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(/\s+/);

  var FALLBACK_COUNTRIES = [
    'Australia', 'Brazil', 'Canada', 'China', 'France', 'Germany', 'Hong Kong', 'India',
    'Indonesia', 'Italy', 'Japan', 'Malaysia', 'New Zealand', 'Philippines',
    'Republic of Korea', 'Singapore', 'Spain', 'Taiwan', 'Thailand',
    'United Kingdom', 'United States', 'Vietnam'
  ];

  var INSTITUTIONS = [
    'A*STAR', 'Argonne National Laboratory', 'Beijing University of Chemical Technology',
    'California Institute of Technology', 'Chinese Academy of Sciences',
    'City University of Hong Kong', 'CSIRO', 'Curtin University', 'ETH Zurich',
    'Georgia Institute of Technology', 'Hong Kong University of Science and Technology',
    'Imperial College London', 'Indian Institute of Science',
    'Indian Institute of Technology Bombay', 'Indian Institute of Technology Delhi',
    'Indian Institute of Technology Kanpur', 'Indian Institute of Technology Kharagpur',
    'Indian Institute of Technology Madras', 'Institut Teknologi Bandung',
    'Japan Science and Technology Agency', 'KAIST', 'King Abdullah University of Science and Technology',
    'Korea Institute of Science and Technology', 'Korea Research Institute of Chemical Technology',
    'Korea University', 'Kyoto University', 'Lawrence Berkeley National Laboratory',
    'Massachusetts Institute of Technology', 'Monash University', 'Nagoya University',
    'Nanyang Technological University', 'National Institute for Materials Science',
    'National Taiwan University', 'National University of Singapore', 'Northwestern University',
    'Oak Ridge National Laboratory', 'Osaka University', 'Pohang University of Science and Technology',
    'Pusan National University', 'Queensland University of Technology', 'Rice University',
    'Seoul National University', 'Shanghai Jiao Tong University', 'Sungkyunkwan University',
    'The University of Hong Kong', 'Tohoku University', 'Tokyo Institute of Technology',
    'Tsinghua University', 'UNIST', 'University College London', 'University of Adelaide',
    'University of Auckland', 'University of California, Berkeley', 'University of California, Los Angeles',
    'University of Cambridge', 'University of Manchester', 'University of Melbourne',
    'University of Minnesota', 'University of New South Wales', 'University of Oxford',
    'University of Queensland', 'University of Science and Technology of China',
    'University of Sydney', 'University of Tokyo', 'University of Toronto',
    'University of Western Australia', 'Yonsei University'
  ];

  function countryNames() {
    if (typeof Intl === 'object' && typeof Intl.DisplayNames === 'function') {
      try {
        var names = new Intl.DisplayNames(['en'], { type: 'region' });
        return REGION_CODES.map(function (code) {
          if (code === 'KR') return 'Republic of Korea';
          return names.of(code);
        }).filter(Boolean).sort(function (a, b) { return a.localeCompare(b); });
      } catch (error) {
        // Older browsers use the compact fallback list below.
      }
    }
    return FALLBACK_COUNTRIES.slice();
  }

  function attachList(selector, id, values) {
    var inputs = document.querySelectorAll(selector);
    if (!inputs.length) return;

    var list = document.createElement('datalist');
    list.id = id;
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
    document.body.appendChild(list);

    inputs.forEach(function (input) {
      input.setAttribute('list', id);
      input.setAttribute('spellcheck', 'false');
    });
  }

  attachList('[data-country-autocomplete]', 'country-options', countryNames());
  attachList('[data-institution-autocomplete]', 'institution-options', INSTITUTIONS);
})();

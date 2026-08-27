/**
 * ISO-3166-1 alpha-2 code to the English country name CJ publishes for it.
 *
 * CJ's `createOrderV2`/`createOrderV3` take the destination country twice, and
 * they are not the same field:
 *
 * | Field                 | CJ's documented meaning              |
 * |-----------------------|--------------------------------------|
 * | `shippingCountryCode` | "Destination country code" - "Use a two-letter country code", max 20 |
 * | `shippingCountry`     | "Destination country" - max 50       |
 *
 * The worker used to send the alpha-2 code to both, so CJ received
 * `shippingCountry: 'AU'` where it documents a country name. CJ accepted it -
 * the six real orders of 2026-08-18 came back `code: 200` with a usable
 * `orderId` - so this is a wire-correctness fix, not a repair for a hard
 * failure, and it changes what a CJ operator reads on the order, not whether
 * the order is created.
 *
 * ## Where these names come from
 *
 * CJ's own country appendix, the table its logistics endpoints link to for
 * country codes, read on 2026-08-27:
 * https://developers.cjdropshipping.cn/en/api/api2/standard/ps-country.html
 *
 * Using CJ's published spelling rather than a general-purpose country list is
 * the whole point: CJ is the party reading the field, and it has already
 * decided how it spells "Viet Nam", "Czechia", and "Taiwan (Province of
 * China)". Reading a name off `Intl.DisplayNames` or a npm country package
 * would produce a spelling nobody at CJ has ever published.
 *
 * No CJ API call was made to build this. The appendix is a documentation page,
 * not an endpoint, so ADR-017's no-local-CJ-calls rule is untouched.
 *
 * ## The three deliberate departures from that table, and why
 *
 * 1. **Non-breaking spaces are normalised to ASCII spaces.** 75 of CJ's rows
 *    render with U+00A0 between words. That is the documentation page's
 *    typesetting, not part of any country's name, and shipping a U+00A0 to a
 *    supplier is a defect waiting for someone to grep for `'New Zealand'` and
 *    find nothing.
 *
 * 2. **A parenthesised group whose entire content is the word "the" is
 *    dropped**, so `PH` is `Philippines`, not `Philippines (the)`, and `US` is
 *    `United States of America`, not `United States of America (the)`. ISO
 *    3166 prints the grammatical article that way in its listing; it is an
 *    annotation about English usage, not a part of the name, and no carrier,
 *    label, or customs form writes it. 26 rows are affected. Groups that carry
 *    real naming detail are untouched - `KR` stays `Korea (the Republic of)`
 *    and `BO` stays `Bolivia (Plurinational State of)` - because the rule
 *    matches only the exact group `(the)`.
 *
 *    This is the one judgement call in the file. The alternative is to send
 *    CJ's string byte-for-byte, `(the)` included. Both are defensible; nothing
 *    in CJ's docs says the field is matched against this table at all, and the
 *    fact that CJ accepted the bare code `PH` says it is not matched strictly.
 *    Legibility to whoever reads the order therefore decided it.
 *
 * 3. **`EH`'s trailing `*` is dropped** - it is ISO's footnote marker for
 *    Western Sahara's disputed status, carried into CJ's table by copy-paste.
 *
 * ## Two defects in CJ's table, preserved rather than silently corrected
 *
 * - **`GB` is truncated**: CJ publishes `United Kingdom of Great Britain and
 *   Northern Irela`, cut at exactly 50 characters, which is also the documented
 *   maximum length of `shippingCountry`. The untruncated ISO name is 52
 *   characters and would not fit the field, so CJ's own 50-character form is
 *   kept verbatim rather than repaired into something CJ never published.
 * - **`CD` is missing entirely.** Its row on CJ's page is malformed - the
 *   two-letter cell is absent and the English cell reads `Congo (the
 *   Democratic Republic of OD`, with the alpha-3 code bleeding into the name -
 *   so CJ publishes no usable name for it. Rather than invent one, `CD` is
 *   omitted and falls through to the raw-code fallback below. Neither `GB` nor
 *   `CD` is an approved buyer destination today
 *   (`src/lib/country-policy/buyer-destination-country.ts`).
 *
 * 249 of CJ's 250 rows are represented, which is every ISO-3166-1 alpha-2 code
 * a buyer address can realistically carry, so the fallback should never fire in
 * production.
 */
const CJ_COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra',
  AE: 'United Arab Emirates',
  AF: 'Afghanistan',
  AG: 'Antigua and Barbuda',
  AI: 'Anguilla',
  AL: 'Albania',
  AM: 'Armenia',
  AO: 'Angola',
  AQ: 'Antarctica',
  AR: 'Argentina',
  AS: 'American Samoa',
  AT: 'Austria',
  AU: 'Australia',
  AW: 'Aruba',
  AX: 'Åland Islands',
  AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina',
  BB: 'Barbados',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BF: 'Burkina Faso',
  BG: 'Bulgaria',
  BH: 'Bahrain',
  BI: 'Burundi',
  BJ: 'Benin',
  BL: 'Saint Barthélemy',
  BM: 'Bermuda',
  BN: 'Brunei Darussalam',
  BO: 'Bolivia (Plurinational State of)',
  BQ: 'Bonaire, Sint Eustatius and Saba',
  BR: 'Brazil',
  BS: 'Bahamas',
  BT: 'Bhutan',
  BV: 'Bouvet Island',
  BW: 'Botswana',
  BY: 'Belarus',
  BZ: 'Belize',
  CA: 'Canada',
  CC: 'Cocos (Keeling) Islands',
  CF: 'Central African Republic',
  CG: 'Congo',
  CH: 'Switzerland',
  CI: "Côte d'Ivoire",
  CK: 'Cook Islands',
  CL: 'Chile',
  CM: 'Cameroon',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CU: 'Cuba',
  CV: 'Cabo Verde',
  CW: 'Curaçao',
  CX: 'Christmas Island',
  CY: 'Cyprus',
  CZ: 'Czechia',
  DE: 'Germany',
  DJ: 'Djibouti',
  DK: 'Denmark',
  DM: 'Dominica',
  DO: 'Dominican Republic',
  DZ: 'Algeria',
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  EH: 'Western Sahara',
  ER: 'Eritrea',
  ES: 'Spain',
  ET: 'Ethiopia',
  FI: 'Finland',
  FJ: 'Fiji',
  FK: 'Falkland Islands [Malvinas]',
  FM: 'Micronesia (Federated States of)',
  FO: 'Faroe Islands',
  FR: 'France',
  GA: 'Gabon',
  GB: 'United Kingdom of Great Britain and Northern Irela',
  GD: 'Grenada',
  GE: 'Georgia',
  GF: 'French Guiana',
  GG: 'Guernsey',
  GH: 'Ghana',
  GI: 'Gibraltar',
  GL: 'Greenland',
  GM: 'Gambia',
  GN: 'Guinea',
  GP: 'Guadeloupe',
  GQ: 'Equatorial Guinea',
  GR: 'Greece',
  GS: 'South Georgia and the South Sandwich Islands',
  GT: 'Guatemala',
  GU: 'Guam',
  GW: 'Guinea-Bissau',
  GY: 'Guyana',
  HK: 'Hong Kong',
  HM: 'Heard Island and McDonald Islands',
  HN: 'Honduras',
  HR: 'Croatia',
  HT: 'Haiti',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IM: 'Isle of Man',
  IN: 'India',
  IO: 'British Indian Ocean Territory',
  IQ: 'Iraq',
  IR: 'Iran (Islamic Republic of)',
  IS: 'Iceland',
  IT: 'Italy',
  JE: 'Jersey',
  JM: 'Jamaica',
  JO: 'Jordan',
  JP: 'Japan',
  KE: 'Kenya',
  KG: 'Kyrgyzstan',
  KH: 'Cambodia',
  KI: 'Kiribati',
  KM: 'Comoros',
  KN: 'Saint Kitts and Nevis',
  KP: "Korea (the Democratic People's Republic of)",
  KR: 'Korea (the Republic of)',
  KW: 'Kuwait',
  KY: 'Cayman Islands',
  KZ: 'Kazakhstan',
  LA: "Lao People's Democratic Republic",
  LB: 'Lebanon',
  LC: 'Saint Lucia',
  LI: 'Liechtenstein',
  LK: 'Sri Lanka',
  LR: 'Liberia',
  LS: 'Lesotho',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  LY: 'Libya',
  MA: 'Morocco',
  MC: 'Monaco',
  MD: 'Moldova (the Republic of)',
  ME: 'Montenegro',
  MF: 'Saint Martin (French part)',
  MG: 'Madagascar',
  MH: 'Marshall Islands',
  MK: 'Macedonia (the former Yugoslav Republic of)',
  ML: 'Mali',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MO: 'Macao',
  MP: 'Northern Mariana Islands',
  MQ: 'Martinique',
  MR: 'Mauritania',
  MS: 'Montserrat',
  MT: 'Malta',
  MU: 'Mauritius',
  MV: 'Maldives',
  MW: 'Malawi',
  MX: 'Mexico',
  MY: 'Malaysia',
  MZ: 'Mozambique',
  NA: 'Namibia',
  NC: 'New Caledonia',
  NE: 'Niger',
  NF: 'Norfolk Island',
  NG: 'Nigeria',
  NI: 'Nicaragua',
  NL: 'Netherlands',
  NO: 'Norway',
  NP: 'Nepal',
  NR: 'Nauru',
  NU: 'Niue',
  NZ: 'New Zealand',
  OM: 'Oman',
  PA: 'Panama',
  PE: 'Peru',
  PF: 'French Polynesia',
  PG: 'Papua New Guinea',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PM: 'Saint Pierre and Miquelon',
  PN: 'Pitcairn',
  PR: 'Puerto Rico',
  PS: 'Palestine, State of',
  PT: 'Portugal',
  PW: 'Palau',
  PY: 'Paraguay',
  QA: 'Qatar',
  RE: 'Réunion',
  RO: 'Romania',
  RS: 'Serbia',
  RU: 'Russian Federation',
  RW: 'Rwanda',
  SA: 'Saudi Arabia',
  SB: 'Solomon Islands',
  SC: 'Seychelles',
  SD: 'Sudan',
  SE: 'Sweden',
  SG: 'Singapore',
  SH: 'Saint Helena, Ascension and Tristan da Cunha',
  SI: 'Slovenia',
  SJ: 'Svalbard and Jan Mayen',
  SK: 'Slovakia',
  SL: 'Sierra Leone',
  SM: 'San Marino',
  SN: 'Senegal',
  SO: 'Somalia',
  SR: 'Suriname',
  SS: 'South Sudan',
  ST: 'Sao Tome and Principe',
  SV: 'El Salvador',
  SX: 'Sint Maarten (Dutch part)',
  SY: 'Syrian Arab Republic',
  SZ: 'Swaziland',
  TC: 'Turks and Caicos Islands',
  TD: 'Chad',
  TF: 'French Southern Territories',
  TG: 'Togo',
  TH: 'Thailand',
  TJ: 'Tajikistan',
  TK: 'Tokelau',
  TL: 'Timor-Leste',
  TM: 'Turkmenistan',
  TN: 'Tunisia',
  TO: 'Tonga',
  TR: 'Turkey',
  TT: 'Trinidad and Tobago',
  TV: 'Tuvalu',
  TW: 'Taiwan (Province of China)',
  TZ: 'Tanzania, United Republic of',
  UA: 'Ukraine',
  UG: 'Uganda',
  UM: 'United States Minor Outlying Islands',
  US: 'United States of America',
  UY: 'Uruguay',
  UZ: 'Uzbekistan',
  VA: 'Holy See',
  VC: 'Saint Vincent and the Grenadines',
  VE: 'Venezuela (Bolivarian Republic of)',
  VG: 'Virgin Islands (British)',
  VI: 'Virgin Islands (U.S.)',
  VN: 'Viet Nam',
  VU: 'Vanuatu',
  WF: 'Wallis and Futuna',
  WS: 'Samoa',
  YE: 'Yemen',
  YK: 'The Republic of Kosovo',
  YT: 'Mayotte',
  ZA: 'South Africa',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
};

/**
 * The value to send as CJ's `shippingCountry` for an alpha-2 country code.
 *
 * Falls back to the input unchanged when the code is unknown, which reproduces
 * exactly what this worker sent before the mapping existed. Throwing instead
 * would be the louder choice, but the only caller is the fulfilment worker
 * running against a *paid* order: an unmapped code would make the CJ step fail
 * permanently - `supplier_order_steps` would retry the same address forever -
 * and strand an order that CJ has already shown it will accept with a bare
 * code. A wrong-looking country name is the cheaper failure.
 *
 * Matching is case-insensitive so a snapshot holding `'ph'` still resolves;
 * `sals3_orders.addressSnapshot` is frozen JSON whose casing this module does
 * not control.
 */
export default function cjShippingCountryName(country: string): string {
  return CJ_COUNTRY_NAMES[country.trim().toUpperCase()] ?? country;
}

// HAND-MAINTAINED, unlike `country-codes.ts` — do not regenerate this file.
//
// `country-codes.ts` is generated from the ISO-3166 list, so it only knows each country by its
// FORMAL name: "Taiwan, Province of China", "United States of America", "Korea, Republic of".
// Nobody types those. An app setting `country` to "Taiwan" or "United States" resolved to nothing,
// rolled into the "Unknown" bucket, and left the map with no countries to shade at all — so the
// world map showed its "no resolvable country" empty state even though the data was perfectly good.
//
// Keys are already normalized the way `toIso3` normalizes its input: lowercased with every
// non-alphanumeric character stripped, so "United-States", "united states" and "UNITED_STATES" all
// arrive here as "unitedstates".

/** Common short names and everyday spellings → ISO-3. */
export const NAME_ALIAS_TO_ISO3: Record<string, string> = {
  // The ones people actually type for countries whose ISO name is a mouthful.
  taiwan: 'TWN',
  unitedstates: 'USA',
  unitedstatesamerica: 'USA',
  america: 'USA',
  unitedkingdomgreatbritain: 'GBR',
  greatbritain: 'GBR',
  britain: 'GBR',
  // Not strictly a country, but an app that reports it means GBR, and dropping it loses the user.
  england: 'GBR',
  scotland: 'GBR',
  wales: 'GBR',
  northernireland: 'GBR',
  netherlands: 'NLD',
  holland: 'NLD',
  turkey: 'TUR',
  // Bare "Korea" is ambiguous in principle; in practice it is always the South, and mapping it
  // beats dropping it. The North is never written as a bare "Korea".
  korea: 'KOR',
  republicofkorea: 'KOR',
  democraticpeoplesrepublicofkorea: 'PRK',
  vatican: 'VAT',
  vaticancity: 'VAT',
  palestine: 'PSE',
  brunei: 'BRN',
  macau: 'MAC',
  capeverde: 'CPV',
  easttimor: 'TLS',
  micronesia: 'FSM',
  drcongo: 'COD',
  democraticrepublicofcongo: 'COD',
  congokinshasa: 'COD',
  congobrazzaville: 'COG',
  sainthelena: 'SHN',
  sthelena: 'SHN',
  southgeorgia: 'SGS',
  falklandislands: 'FLK',
  britishvirginislands: 'VGB',
  usvirginislands: 'VIR',
  unitedstatesvirginislands: 'VIR',
  // "St." forms of the saint-prefixed names, which the generated list only has as "saint…".
  stkittsandnevis: 'KNA',
  stlucia: 'LCA',
  stvincentandthegrenadines: 'VCT',
  stmartin: 'MAF',
  stbarthelemy: 'BLM',
  stpierreandmiquelon: 'SPM',
  // Diacritic-free and alternative spellings.
  turkiye: 'TUR',
  curacao: 'CUW',
  reunion: 'REU',
  alandislands: 'ALA',
  saobenedict: 'STP',
  saotome: 'STP',
  // Older names still in circulation.
  macedonia: 'MKD',
  czechrepublic: 'CZE',
  swaziland: 'SWZ',
  burma: 'MMR',
};

/**
 * Display names for the countries whose formal ISO name reads badly in a dashboard table. Only the
 * awkward ones are overridden; everything else keeps its ISO name, so this stays a short list
 * rather than a second copy of the world.
 */
export const ISO3_SHORT_NAME: Record<string, string> = {
  USA: 'United States',
  GBR: 'United Kingdom',
  TWN: 'Taiwan',
  KOR: 'South Korea',
  PRK: 'North Korea',
  NLD: 'Netherlands',
  RUS: 'Russia',
  IRN: 'Iran',
  SYR: 'Syria',
  VNM: 'Vietnam',
  LAO: 'Laos',
  BOL: 'Bolivia',
  VEN: 'Venezuela',
  TZA: 'Tanzania',
  MDA: 'Moldova',
  COD: 'DR Congo',
  COG: 'Republic of the Congo',
  BRN: 'Brunei',
  PSE: 'Palestine',
  FSM: 'Micronesia',
  VGB: 'British Virgin Islands',
  VIR: 'U.S. Virgin Islands',
  FLK: 'Falkland Islands',
  BES: 'Caribbean Netherlands',
  SHN: 'Saint Helena',
  MAF: 'Saint Martin',
  SXM: 'Sint Maarten',
  VAT: 'Vatican City',
};

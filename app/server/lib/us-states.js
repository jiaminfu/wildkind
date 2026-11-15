/* ============================================================
   LASTGROVE · 美国州名归一化
   为什么需要这一层：结算页的 State 字段是文本输入，人可能填
   "California" / "calif" / "CA" / "ca"。销售税是按收货州算的，
   如果直接取前两个字母，"New York" 会变成 NE（Nebraska）、
   "Virginia" 会变成 VI（不存在的州）—— 税算到错的州，比不算更糟。

   所以规则是：先精确匹配全称，再匹配两位码，都不中就当「未知州」
   返回空字符串，由调用方按 0 税处理。宁可少收（漏收可以补申报），
   不可错收（错收要退款，退比收难十倍）。
   ============================================================ */
'use strict';

const NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

const CODES = Object.keys(NAME_TO_CODE).reduce((m, k) => {
  m[NAME_TO_CODE[k]] = true;
  return m;
}, {});

/* 常见缩写（美国邮政以外的口语写法），只收确实会被填进来的 */
const ALIASES = {
  calif: 'CA', Calif: 'CA', penn: 'PA', pennsylvania: 'PA', wash: 'WA',
  'washington state': 'WA', 'washington dc': 'DC', 'd.c.': 'DC',
};

function normalizeState(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return '';

  const key = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  if (NAME_TO_CODE[key]) return NAME_TO_CODE[key];
  if (ALIASES[key]) return ALIASES[key];

  /* 两位码：必须是大写或全小写且确实存在于表里，避免 "ne" 被当成误输入 */
  const up = raw.toUpperCase();
  if (up.length === 2 && CODES[up]) return up;

  /* 兜底：全称后面跟了多余词（"Brooklyn, New York"），取能命中的最长后缀 */
  for (const name of Object.keys(NAME_TO_CODE)) {
    if (key.endsWith(name)) return NAME_TO_CODE[name];
  }
  return '';
}

module.exports = { normalizeState, NAME_TO_CODE, CODES, ALL_CODES: Object.keys(CODES) };

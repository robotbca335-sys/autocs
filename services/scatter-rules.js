// ============================================================
// SCATTER RULES - tabel hadiah scatter dari extension asli
// - AUTO RELAX: calcHadiah continuous threshold
// - AUTO SCATER FULL HD: DEFAULT_SCATTER_RULES tier-based
// ============================================================

// DEFAULT_SCATTER_RULES (AUTO SCATER FULL HD): [minBet, maxBet] -> prizes {3,4,5}
const DEFAULT_SCATTER_RULES = [
  { minBet: 20000,    maxBet: 10000000, prizes: { 3: 100000, 4: 200000, 5: 400000 } },
  { minBet: 10000,    maxBet: 18000,    prizes: { 3: 50000,  4: 100000, 5: 200000 } },
  { minBet: 4000,     maxBet: 8000,     prizes: { 3: 35000,  4: 70000,  5: 140000 } },
  { minBet: 1600,     maxBet: 2000,     prizes: { 3: 15000,  4: 30000,  5: 75000 } }
];

// Hadiah threshold berkesinambungan (AUTO RELAX calcHadiah)
function calcHadiahAUTO_RELAX(bet, scatter) {
  const levels = [
    { minBet: 20000, prizes: { 3: 100000, 4: 200000, 5: 400000 } },
    { minBet: 10000, prizes: { 3: 50000,  4: 100000, 5: 200000 } },
    { minBet: 4000,  prizes: { 3: 35000,  4: 70000,  5: 140000 } },
    { minBet: 1600,  prizes: { 3: 15000,  4: 30000,  5: 75000 } }
  ];
  for (const lvl of levels) {
    if (bet >= lvl.minBet) return lvl.prizes[scatter] || 0;
  }
  return 0;
}

// Ambil prize {3,4,5} via DEFAULT_SCATTER_RULES; bet di celah (gap) jatuh ke tier terdekat terendah
function getScatterPrizes(bet) {
  if (!bet || bet < 1600) return null;
  for (let i = DEFAULT_SCATTER_RULES.length - 1; i >= 0; i--) {
    const tier = DEFAULT_SCATTER_RULES[i];
    if (bet <= tier.maxBet) return tier.prizes;
  }
  return DEFAULT_SCATTER_RULES[0].prizes;
}

function expectedHadiah(bet, scatter) {
  if (![3, 4, 5].includes(scatter)) return 0;
  const prizes = getScatterPrizes(bet);
  return prizes ? (prizes[scatter] || 0) : 0;
}

module.exports = {
  DEFAULT_SCATTER_RULES,
  calcHadiahAUTO_RELAX,
  getScatterPrizes,
  expectedHadiah
};
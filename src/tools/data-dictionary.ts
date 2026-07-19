// Static data dictionary: field semantics, state codes, and known pitfalls
// that are otherwise rediscovered (painfully) on every investigation.

const DICTIONARY: Record<string, any> = {
  amounts: {
    summary: 'Almost every monetary field is in USD cents (integers).',
    examples: [
      'ranks.maxDailyWithdraw = 1000000 means $10,000/day',
      'tradings.gemPrice = [22857] means $228.57 (array — take element 0)',
      'pendingwithdraws.usdValue is in cents',
    ],
  },
  gems_vs_usd: {
    summary:
      'Gems are booked 1:1 to USD. Financial totals that mix gems with real money are inflated roughly 8x. Always split by currency and treat gem amounts separately from cash flows.',
    pitfalls: [
      'bonuses.usdValue is always 0 — do not sum it',
      'Platform-wide "USD" aggregates over bets/ledgers include gem play; only tradings deposits/withdrawals are real cash',
    ],
  },
  ngr: {
    summary:
      'NGR = -netPnl (player net loss = platform gain). The BO/deck "cash NGR" is net cash flow: deposits - withdrawals from tradings (see bo_stats_rules). Use get_platform_stats for BO-consistent figures.',
  },
  sports: {
    summary: 'Sports betting (BetConstruct) lives in bctransactions.',
    fields: {
      userPublicId: 'joins to users.publicId — NOT the ObjectId',
      operation: 'bet_placed | bet_resulted | rollback',
      betState: '4 = won, 3 = lost, 2 = void',
      amountUSD_deltaUSD: 'transaction amount and balance delta in USD',
    },
  },
  user_keys: {
    summary: 'The user reference field differs per collection.',
    byCollection: {
      userId:
        'bets, ledgers, bonuses, loginhistories, iphistories, playerdailystats, referralclaimhistories, userbalances, userbonuseligibilities (ObjectId)',
      requestedUser: 'tradings, pendingwithdraws, failedwithdrawals (ObjectId)',
      referrerUser: 'referraldeposits (ObjectId)',
      userPublicId: 'bctransactions (string publicId)',
    },
  },
  bo_stats_rules: {
    summary:
      'How the back office computes platform financials from tradings (mirrored by get_platform_stats).',
    rules: [
      'amount = gemPrice[0] (or scalar gemPrice), USD cents',
      'deposit = action matches ^DEPOSIT_ or equals "Deposit"; withdraw = ^WITHDRAW_ or "Withdraw"',
      'exclude: status = failed; blockchain = 5HsZR8eG7QpQcN8Mnp8oFdENRkJMP9ZkcKhPSCKTJSWh; MRC migration ({failedReason: "Generated_By_Migration", blockchain: "MRC"}); action = SWAP_GEMS_TO_MRC',
      'exclude users in statsexclusions.userId ∪ botconfigs.userId',
      'registrations (deck "New sign-ups") = users.createdAt count, NO exclusions',
    ],
  },
  withdraw_rules: {
    summary: 'Daily withdrawal limit logic (see check_withdraw_eligibility).',
    rules: [
      'daily limit = max(2 × successful deposits last 24h, rank maxDailyWithdraw), in cents',
      'rank = highest ranks.min ≤ users.stats.wageredUSDCents',
      'withdrawconfigurations is empty in prod → default minimum withdrawal $5',
      'KYC required for withdrawals above $500 (users.kycStatus)',
      'wager requirement: stats.wageredUSDCents must reach stats.minWageredBeforeWithdraw',
      'pendingwithdraws.reason records which rule held a withdrawal (e.g. WithdrawDepositRatioExceeded)',
    ],
  },
  ledger: {
    summary:
      'ledgers is the balance-changing journal: operation (bet-place, bet-win, deposit, withdraw, bonus, tip, swap, ...), amount, currency, balanceAfter. balanceAfter is the fastest way to trace balance anomalies.',
  },
  run_query_tips: {
    summary: 'run_query accepts MongoDB Extended JSON in filters/sort.',
    tips: [
      'ObjectId: {"userId": {"$oid": "64..."}}',
      'Date: {"createdAt": {"$gte": {"$date": "2026-07-01T00:00:00Z"}}}',
      'findOne honors sort — use sort {"createdAt":-1} for "latest"',
      'find totals are capped at 1000 (totalCapped: true when hit)',
      'All createdAt/date fields are BSON Dates across collections',
    ],
  },
};

interface GetDataDictionaryParams {
  topic?: string;
}

export async function getDataDictionary(params: GetDataDictionaryParams) {
  const topics = Object.keys(DICTIONARY);
  if (params.topic) {
    const needle = params.topic.trim().toLowerCase();
    const matched = topics.filter(
      (t) => t.includes(needle) || JSON.stringify(DICTIONARY[t]).toLowerCase().includes(needle)
    );
    if (matched.length === 0) {
      return { error: `No topic matching "${params.topic}"`, availableTopics: topics };
    }
    return Object.fromEntries(matched.map((t) => [t, DICTIONARY[t]]));
  }
  return DICTIONARY;
}

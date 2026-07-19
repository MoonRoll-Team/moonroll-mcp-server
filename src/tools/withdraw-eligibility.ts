import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { findUser } from './find-user.js';

// withdrawconfigurations is empty in prod; the BO falls back to a $5 minimum
const DEFAULT_MIN_WITHDRAW_CENTS = 500;
// KYC is required for withdrawals above $500
const KYC_THRESHOLD_CENTS = 50000;

// tradings.gemPrice is an array (element 0) or a scalar, in USD cents
const rawAmount = {
  $cond: [
    { $isArray: '$gemPrice' },
    { $ifNull: [{ $arrayElemAt: ['$gemPrice', 0] }, 0] },
    { $ifNull: ['$gemPrice', 0] },
  ],
};
const actionGroup = {
  $cond: [
    {
      $or: [
        { $regexMatch: { input: '$action', regex: /^WITHDRAW_/ } },
        { $eq: ['$action', 'Withdraw'] },
      ],
    },
    'withdraw',
    {
      $cond: [
        {
          $or: [
            { $regexMatch: { input: '$action', regex: /^DEPOSIT_/ } },
            { $eq: ['$action', 'Deposit'] },
          ],
        },
        'deposit',
        'other',
      ],
    },
  ],
};

interface CheckWithdrawEligibilityParams {
  userId: string;
}

const usd = (cents: number) => Math.round(cents) / 100;

export async function checkWithdrawEligibility(params: CheckWithdrawEligibilityParams) {
  const found = await findUser(params.userId.trim());
  if (!found.found || !found.user) {
    return { error: `No user found matching "${params.userId}"` };
  }
  const user: any = found.user;
  const userOid = new mongoose.Types.ObjectId(String(user._id));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const db = (await getConnection()).db!;
  const [ranks, flows, pendingAgg] = await Promise.all([
    db.collection('ranks').find({}).toArray(),
    db
      .collection('tradings')
      .aggregate([
        { $match: { requestedUser: userOid, status: 'success', createdAt: { $gte: since } } },
        { $addFields: { amt: rawAmount, ag: actionGroup } },
        { $group: { _id: '$ag', total: { $sum: '$amt' }, count: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection('pendingwithdraws')
      .aggregate([
        { $match: { requestedUser: userOid } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$usdValue', 0] } }, count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  const deposits24h = flows.find((f: any) => f._id === 'deposit')?.total || 0;
  const withdrawals24h = flows.find((f: any) => f._id === 'withdraw')?.total || 0;
  const pending = pendingAgg[0] || { total: 0, count: 0 };

  // Rank = highest ranks.min the user's lifetime wager has reached
  const wagered = user.stats?.wageredUSDCents || 0;
  let rank: any = null;
  for (const r of ranks
    .filter((r: any) => typeof r.min === 'number')
    .sort((a: any, b: any) => a.min - b.min)) {
    if (wagered >= r.min) rank = r;
  }
  const rankCap = rank?.maxDailyWithdraw || 0;
  const depositRule = 2 * deposits24h;
  const dailyLimit = Math.max(depositRule, rankCap);
  const used = withdrawals24h + pending.total;
  const remaining = Math.max(0, dailyLimit - used);

  const minWageredBeforeWithdraw = user.stats?.minWageredBeforeWithdraw || 0;
  const flagsOk = !user.isLocked && !user.isSuspended && !user.withdrawInProgress;

  return {
    user: { id: String(user._id), name: user.name || '', publicId: user.publicId || null },
    dailyLimit: {
      usd: usd(dailyLimit),
      cents: dailyLimit,
      bindingRule: depositRule >= rankCap ? '2x_deposits_last_24h' : 'rank_maxDailyWithdraw',
      components: {
        depositsLast24hUSD: usd(deposits24h),
        depositRuleUSD: usd(depositRule),
        rank: rank ? { name: rank.name, maxDailyWithdrawUSD: usd(rankCap) } : null,
      },
    },
    usage: {
      successfulWithdrawalsLast24hUSD: usd(withdrawals24h),
      pendingWithdrawals: { count: pending.count, totalUSD: usd(pending.total) },
      remainingTodayUSD: usd(remaining),
    },
    checks: [
      {
        rule: 'account_flags',
        pass: flagsOk,
        detail: {
          isLocked: !!user.isLocked,
          isSuspended: !!user.isSuspended,
          withdrawInProgress: !!user.withdrawInProgress,
          limitations: user.limitations || null,
        },
      },
      {
        rule: 'wager_requirement',
        pass: wagered >= minWageredBeforeWithdraw,
        detail: {
          wageredUSD: usd(wagered),
          minWageredBeforeWithdrawUSD: usd(minWageredBeforeWithdraw),
          shortfallUSD: usd(Math.max(0, minWageredBeforeWithdraw - wagered)),
        },
      },
      {
        // kycStatus values in prod: unrequired, completed, pending, required, rejected
        rule: 'kyc',
        pass: user.kycStatus === 'completed' || remaining <= KYC_THRESHOLD_CENTS,
        detail: {
          kycStatus: user.kycStatus || 'unknown',
          requiredAboveUSD: usd(KYC_THRESHOLD_CENTS),
        },
      },
      {
        rule: 'min_withdraw',
        detail: { minWithdrawUSD: usd(DEFAULT_MIN_WITHDRAW_CENTS) },
      },
    ],
    balance: found.balance || null,
    note: 'Best-effort reconstruction of the BO withdrawal rules (limit = max(2x deposits 24h, rank cap); pendingwithdraws.reason records which rule actually held a request).',
  };
}

import mongoose from 'mongoose';
import { getConnection } from '../db.js';

// BO exclusion rules — keep in sync with stats.routes.ts / the deck
// reconciliation script (scripts/pull-deck-reconciliation.ts).
const EXCLUDED_BLOCKCHAIN = '5HsZR8eG7QpQcN8Mnp8oFdENRkJMP9ZkcKhPSCKTJSWh';

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

interface GetPlatformStatsParams {
  startMonth?: string;
  endMonth?: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthStartUTC(ym: string): Date {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function ymOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const usd = (cents: number) => Math.round(cents) / 100;

export async function getPlatformStats(params: GetPlatformStatsParams) {
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  if (params.startMonth && !MONTH_RE.test(params.startMonth)) {
    return { error: 'startMonth must be YYYY-MM' };
  }
  if (params.endMonth && !MONTH_RE.test(params.endMonth)) {
    return { error: 'endMonth must be YYYY-MM' };
  }

  const endStart = params.endMonth ? monthStartUTC(params.endMonth) : currentMonthStart;
  const startStart = params.startMonth ? monthStartUTC(params.startMonth) : addMonths(endStart, -11);
  if (startStart > endStart) {
    return { error: 'startMonth must be <= endMonth' };
  }

  const winStart = startStart;
  const winEnd = addMonths(endStart, 1);

  const db = (await getConnection()).db!;

  // Excluded users = statsexclusions ∪ botconfigs (BO rule)
  const [manualRaw, botRaw] = await Promise.all([
    db.collection('statsexclusions').distinct('userId').catch(() => [] as any[]),
    db.collection('botconfigs').distinct('userId').catch(() => [] as any[]),
  ]);
  const exMap = new Map<string, mongoose.Types.ObjectId>();
  for (const v of [...manualRaw, ...botRaw]) {
    try {
      const o = v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v));
      exMap.set(o.toString(), o);
    } catch {
      // ignore malformed ids
    }
  }
  const excludedIds = Array.from(exMap.values());

  const base = (start: Date, end: Date) => ({
    createdAt: { $gte: start, $lt: end },
    status: { $ne: 'failed' },
    requestedUser: { $nin: excludedIds },
    blockchain: { $ne: EXCLUDED_BLOCKCHAIN },
    $nor: [{ failedReason: 'Generated_By_Migration', blockchain: 'MRC' }],
    action: { $ne: 'SWAP_GEMS_TO_MRC' },
  });

  const tradings = db.collection('tradings');
  const byMonth = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };

  const [flows, uniqueDep, ftd, regs] = await Promise.all([
    // Monthly cash flows
    tradings
      .aggregate(
        [
          { $match: base(winStart, winEnd) },
          { $addFields: { ag: actionGroup, amt: rawAmount } },
          {
            $group: {
              _id: byMonth,
              dep: { $sum: { $cond: [{ $eq: ['$ag', 'deposit'] }, '$amt', 0] } },
              wd: { $sum: { $cond: [{ $eq: ['$ag', 'withdraw'] }, '$amt', 0] } },
            },
          },
        ],
        { allowDiskUse: true }
      )
      .toArray(),
    // Unique depositors per month
    tradings
      .aggregate(
        [
          { $match: base(winStart, winEnd) },
          { $addFields: { ag: actionGroup } },
          { $match: { ag: 'deposit' } },
          { $group: { _id: { m: byMonth, u: '$requestedUser' } } },
          { $group: { _id: '$_id.m', n: { $sum: 1 } } },
        ],
        { allowDiskUse: true }
      )
      .toArray(),
    // First-time depositors: first deposit ever (full history), bucketed by month
    tradings
      .aggregate(
        [
          { $match: base(new Date(Date.UTC(2020, 0, 1)), winEnd) },
          { $addFields: { ag: actionGroup } },
          { $match: { ag: 'deposit' } },
          { $group: { _id: '$requestedUser', first: { $min: '$createdAt' } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$first' } }, n: { $sum: 1 } } },
        ],
        { allowDiskUse: true }
      )
      .toArray(),
    // Registrations per month — deliberately no exclusions (matches deck "New sign-ups")
    db
      .collection('users')
      .aggregate(
        [
          { $match: { createdAt: { $gte: winStart, $lt: winEnd } } },
          { $group: { _id: byMonth, n: { $sum: 1 } } },
        ],
        { allowDiskUse: true }
      )
      .toArray(),
  ]);

  const mFlow = new Map(flows.map((r: any) => [r._id, r]));
  const mUnique = new Map(uniqueDep.map((r: any) => [r._id, r.n]));
  const mFtd = new Map(ftd.map((r: any) => [r._id, r.n]));
  const mReg = new Map(regs.map((r: any) => [r._id, r.n]));

  const months: any[] = [];
  for (let d = winStart; d < winEnd; d = addMonths(d, 1)) {
    const m = ymOf(d);
    const f: any = mFlow.get(m) || { dep: 0, wd: 0 };
    months.push({
      month: m,
      depositsUSD: usd(f.dep),
      withdrawalsUSD: usd(f.wd),
      netCashUSD: usd(f.dep - f.wd),
      uniqueDepositors: mUnique.get(m) || 0,
      firstTimeDepositors: mFtd.get(m) || 0,
      registrations: mReg.get(m) || 0,
    });
  }

  return {
    window: { startMonth: ymOf(winStart), endMonth: ymOf(endStart) },
    currentMonthPartial: endStart.getTime() === currentMonthStart.getTime(),
    excludedUserCount: excludedIds.length,
    months,
    methodology:
      'BO-consistent: amount = gemPrice[0] in USD cents; deposit/withdraw via ^DEPOSIT_/^WITHDRAW_; excludes failed, excluded blockchain, MRC migration, gem swaps, and statsexclusions ∪ botconfigs users. netCashUSD = deposits - withdrawals (cash NGR). Registrations have no exclusions.',
  };
}

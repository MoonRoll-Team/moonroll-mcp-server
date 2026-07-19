import mongoose from 'mongoose';
import { getConnection, COUNT_CAP, capCount } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserBetsParams {
  userId: string;
  gameType?: string;
  status?: string;
  currency?: string;
  startDate?: string;
  endDate?: string;
  minProfit?: number;
  limit?: number;
  skip?: number;
  full?: boolean;
}

// Compact view: drop per-game state blobs (blackjackDetails, minesDetails, ...)
// and provable-fairness seeds — they dominate response size. full: true keeps them.
const VERBOSE_BET_FIELDS = new Set([
  'serverSeed',
  'serverSeedHash',
  'clientSeed',
  'seedUniquenessEnforced',
  '__v',
]);

function compactBet(doc: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.endsWith('Details') || VERBOSE_BET_FIELDS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export async function getUserBets(params: GetUserBetsParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;
  const bets = db.collection('bets');

  const filter: Record<string, any> = {
    userId: new mongoose.Types.ObjectId(resolved.userId),
  };

  if (params.gameType) filter.gameType = params.gameType;
  if (params.status) filter.status = params.status;
  if (params.currency) filter.currency = params.currency;

  if (params.startDate || params.endDate) {
    filter.createdAt = {};
    if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) filter.createdAt.$lte = new Date(params.endDate);
  }

  if (params.minProfit !== undefined) {
    filter.profit = { $gte: params.minProfit };
  }

  const limit = Math.min(params.limit || 50, 200);
  const skip = params.skip || 0;

  const [results, total] = await Promise.all([
    bets.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    bets.countDocuments(filter, { limit: COUNT_CAP }),
  ]);

  const view = params.full ? results : results.map(compactBet);

  return {
    resolvedUser: resolved,
    bets: view,
    ...(params.full ? {} : { view: 'compact — game-state details and seeds omitted; pass full: true for complete documents' }),
    ...capCount(total),
    limit,
    skip,
  };
}

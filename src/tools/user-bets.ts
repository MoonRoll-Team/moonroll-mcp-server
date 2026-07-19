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

  return { resolvedUser: resolved, bets: results, ...capCount(total), limit, skip };
}

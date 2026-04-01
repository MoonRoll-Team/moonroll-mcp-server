import mongoose from 'mongoose';
import { getConnection } from '../db.js';

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
  const db = (await getConnection()).db!;
  const bets = db.collection('bets');

  const filter: Record<string, any> = {
    userId: new mongoose.Types.ObjectId(params.userId),
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

  const results = await bets
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await bets.countDocuments(filter);

  return { bets: results, total, limit, skip };
}

import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserDailyStatsParams {
  userId: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getUserDailyStats(params: GetUserDailyStatsParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;

  const filter: Record<string, any> = {
    userId: new mongoose.Types.ObjectId(resolved.userId),
  };

  if (params.startDate || params.endDate) {
    filter.date = {};
    if (params.startDate) filter.date.$gte = new Date(params.startDate);
    if (params.endDate) filter.date.$lte = new Date(params.endDate);
  }

  const limit = Math.min(params.limit || 30, 90);

  const stats = await db
    .collection('playerdailystats')
    .find(filter)
    .sort({ date: -1 })
    .limit(limit)
    .toArray();

  return { resolvedUser: resolved, stats, count: stats.length };
}

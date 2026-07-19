import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserBonusesParams {
  userId: string;
  type?: string;
  currency?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getUserBonuses(params: GetUserBonusesParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;

  const userOid = new mongoose.Types.ObjectId(resolved.userId);
  const limit = Math.min(params.limit || 50, 200);

  // Bonus history
  const bonusFilter: Record<string, any> = { userId: userOid };
  if (params.type) bonusFilter.type = params.type;
  if (params.currency) bonusFilter.currency = params.currency;
  if (params.startDate || params.endDate) {
    bonusFilter.createdAt = {};
    if (params.startDate) bonusFilter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) bonusFilter.createdAt.$lte = new Date(params.endDate);
  }

  const [bonuses, eligibilities] = await Promise.all([
    db.collection('bonuses').find(bonusFilter).sort({ createdAt: -1 }).limit(limit).toArray(),
    db.collection('userbonuseligibilities').find({ userId: userOid }).toArray(),
  ]);

  return { resolvedUser: resolved, bonuses, eligibilities, bonusCount: bonuses.length };
}

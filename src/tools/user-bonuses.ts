import mongoose from 'mongoose';
import { getConnection } from '../db.js';

interface GetUserBonusesParams {
  userId: string;
  type?: string;
  currency?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getUserBonuses(params: GetUserBonusesParams) {
  const db = (await getConnection()).db!;

  const userOid = new mongoose.Types.ObjectId(params.userId);
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

  const bonuses = await db
    .collection('bonuses')
    .find(bonusFilter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  // Current eligibility
  const eligibilities = await db
    .collection('userbonuseligibilities')
    .find({ userId: userOid })
    .toArray();

  return { bonuses, eligibilities, bonusCount: bonuses.length };
}

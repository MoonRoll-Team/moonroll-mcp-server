import mongoose from 'mongoose';
import { getConnection, COUNT_CAP, capCount } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserTradingsParams {
  userId: string;
  action?: string;
  status?: string;
  blockchain?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

export async function getUserTradings(params: GetUserTradingsParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;
  const tradings = db.collection('tradings');

  const filter: Record<string, any> = {
    requestedUser: new mongoose.Types.ObjectId(resolved.userId),
  };

  if (params.action) filter.action = params.action;
  if (params.status) filter.status = params.status;
  if (params.blockchain) filter.blockchain = params.blockchain;

  if (params.startDate || params.endDate) {
    filter.createdAt = {};
    if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) filter.createdAt.$lte = new Date(params.endDate);
  }

  const limit = Math.min(params.limit || 50, 200);
  const skip = params.skip || 0;

  const results = await tradings
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await tradings.countDocuments(filter, { limit: COUNT_CAP });

  return { resolvedUser: resolved, tradings: results, ...capCount(total), limit, skip };
}

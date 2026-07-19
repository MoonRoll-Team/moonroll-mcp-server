import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserSessionsParams {
  userId: string;
  type?: 'login' | 'ip';
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getUserSessions(params: GetUserSessionsParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;
  const collectionName =
    params.type === 'ip' ? 'iphistories' : 'loginhistories';
  const collection = db.collection(collectionName);

  const filter: Record<string, any> = {
    userId: new mongoose.Types.ObjectId(resolved.userId),
  };

  if (params.startDate || params.endDate) {
    filter.createdAt = {};
    if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) filter.createdAt.$lte = new Date(params.endDate);
  }

  const limit = Math.min(params.limit || 50, 200);

  const results = await collection
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return { resolvedUser: resolved, sessions: results, type: params.type || 'login', count: results.length };
}

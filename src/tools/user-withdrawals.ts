import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserWithdrawalsParams {
  userId: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getUserWithdrawals(params: GetUserWithdrawalsParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;

  const userOid = new mongoose.Types.ObjectId(resolved.userId);
  const limit = Math.min(params.limit || 50, 200);

  const dateFilter: Record<string, any> = {};
  if (params.startDate || params.endDate) {
    if (params.startDate) dateFilter.$gte = new Date(params.startDate);
    if (params.endDate) dateFilter.$lte = new Date(params.endDate);
  }

  const pendingFilter: Record<string, any> = { requestedUser: userOid };
  if (params.status) pendingFilter.status = params.status;
  if (Object.keys(dateFilter).length) pendingFilter.createdAt = dateFilter;

  const failedFilter: Record<string, any> = { requestedUser: userOid };
  if (Object.keys(dateFilter).length) failedFilter.createdAt = dateFilter;

  const [pending, failed] = await Promise.all([
    db.collection('pendingwithdraws').find(pendingFilter).sort({ createdAt: -1 }).limit(limit).toArray(),
    db.collection('failedwithdrawals').find(failedFilter).sort({ createdAt: -1 }).limit(limit).toArray(),
  ]);

  return { resolvedUser: resolved, pending, failed, pendingCount: pending.length, failedCount: failed.length };
}

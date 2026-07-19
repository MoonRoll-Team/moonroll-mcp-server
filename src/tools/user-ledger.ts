import mongoose from 'mongoose';
import { getConnection, COUNT_CAP, capCount } from '../db.js';
import { resolveUserId } from './find-user.js';

interface GetUserLedgerParams {
  userId: string;
  operation?: string;
  currency?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

export async function getUserLedger(params: GetUserLedgerParams) {
  const resolved = await resolveUserId(params.userId.trim());
  if (!resolved) return { error: `No user found matching "${params.userId}"` };

  const db = (await getConnection()).db!;
  const ledgers = db.collection('ledgers');

  const filter: Record<string, any> = {
    userId: new mongoose.Types.ObjectId(resolved.userId),
  };

  if (params.operation) filter.operation = params.operation;
  if (params.currency) filter.currency = params.currency;

  if (params.startDate || params.endDate) {
    filter.createdAt = {};
    if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) filter.createdAt.$lte = new Date(params.endDate);
  }

  const limit = Math.min(params.limit || 50, 200);
  const skip = params.skip || 0;

  const results = await ledgers
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await ledgers.countDocuments(filter, { limit: COUNT_CAP });

  return { resolvedUser: resolved, ledger: results, ...capCount(total), limit, skip };
}

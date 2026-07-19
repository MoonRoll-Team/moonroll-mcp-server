import mongoose from 'mongoose';
import { getConnection, COUNT_CAP } from '../db.js';

interface GetUserSportsActivityParams {
  userId: string;
  include?: string;
  operation?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

const DEFAULT_INCLUDES = new Set([
  'summary',
  'transactions',
  'bets',
]);

function parseIncludes(include?: string): Set<string> {
  if (!include) return DEFAULT_INCLUDES;

  const parts = include
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  return parts.length > 0 ? new Set(parts) : DEFAULT_INCLUDES;
}

function dateRange(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return undefined;

  const createdAt: Record<string, Date> = {};
  if (startDate) createdAt.$gte = new Date(startDate);
  if (endDate) createdAt.$lte = new Date(endDate);
  return createdAt;
}

export async function resolveSportsUser(db: any, query: string) {
  const users = db.collection('users');
  let user = null;

  if (mongoose.Types.ObjectId.isValid(query) && query.length === 24) {
    user = await users.findOne(
      { _id: new mongoose.Types.ObjectId(query) },
      { projection: { _id: 1, publicId: 1, name: 1, email: 1 } }
    );
  }

  if (!user) {
    user = await users.findOne(
      { publicId: query },
      { projection: { _id: 1, publicId: 1, name: 1, email: 1 } }
    );
  }

  if (!user) {
    user = await users.findOne(
      { email: query },
      { projection: { _id: 1, publicId: 1, name: 1, email: 1 } }
    );
  }

  if (!user) {
    user = await users.findOne(
      { name: query },
      { projection: { _id: 1, publicId: 1, name: 1, email: 1 } }
    );
  }

  if (!user?.publicId) return null;

  return {
    _id: String(user._id),
    publicId: user.publicId,
    name: user.name || '',
    email: user.email || '',
  };
}

async function readBetconstruct(
  db: any,
  params: GetUserSportsActivityParams,
  publicId: string,
  includes: Set<string>
) {
  const limit = Math.min(params.limit || 50, 200);
  const skip = params.skip || 0;
  const createdAt = dateRange(params.startDate, params.endDate);

  const transactionFilter: Record<string, any> = {
    userPublicId: publicId,
  };
  if (params.operation) transactionFilter.operation = params.operation;
  if (createdAt) transactionFilter.createdAt = createdAt;

  const transactionCollection = db.collection('bctransactions');
  const [transactions, totalTransactions] = await Promise.all([
    includes.has('transactions')
      ? transactionCollection
          .find(transactionFilter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray()
      : Promise.resolve([]),
    transactionCollection.countDocuments(transactionFilter, { limit: COUNT_CAP }),
  ]);

  const relatedByBetId: Record<string, any[]> = {};
  if (includes.has('bets') && transactions.length > 0) {
    const betIds = [...new Set(transactions.map((tx: any) => tx.betId).filter(Boolean))];
    const related = await transactionCollection
      .find({ userPublicId: publicId, betId: { $in: betIds } })
      .sort({ createdAt: 1 })
      .toArray();

    for (const tx of related) {
      if (!relatedByBetId[tx.betId]) relatedByBetId[tx.betId] = [];
      relatedByBetId[tx.betId].push(tx);
    }
  }

  let summary = null;
  if (includes.has('summary')) {
    const summaryRows = await transactionCollection
      .aggregate([
        { $match: transactionFilter },
        {
          $group: {
            _id: { operation: '$operation', isMrcBet: '$isMrcBet' },
            count: { $sum: 1 },
            amountUSD: { $sum: '$amountUSD' },
            deltaUSD: { $sum: { $ifNull: ['$deltaUSD', 0] } },
            amountInUserCurrency: { $sum: '$amountInUserCurrency' },
          },
        },
        { $sort: { '_id.operation': 1, '_id.isMrcBet': 1 } },
      ])
      .toArray();

    summary = {
      byOperation: summaryRows,
    };
  }

  return {
    totalTransactions,
    ...(totalTransactions >= COUNT_CAP ? { totalTransactionsCapped: true } : {}),
    limit,
    skip,
    summary,
    transactions,
    relatedByBetId,
  };
}

export async function getUserSportsActivity(params: GetUserSportsActivityParams) {
  const db = (await getConnection()).db!;
  const user = await resolveSportsUser(db, params.userId);

  if (!user) {
    return { found: false, message: `No user found matching "${params.userId}"` };
  }

  const includes = parseIncludes(params.include);
  const result: Record<string, any> = {
    found: true,
    user,
    provider: 'betconstruct',
    include: [...includes],
  };

  result.betconstruct = await readBetconstruct(db, params, user.publicId, includes);

  return result;
}

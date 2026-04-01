import mongoose from 'mongoose';
import { getConnection } from '../db.js';

interface GetUserSportsBetsParams {
  userId: string;
  statusBetslip?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function getUserSportsBets(params: GetUserSportsBetsParams) {
  const db = (await getConnection()).db!;

  const filter: Record<string, any> = {
    player_id_moonroll: params.userId,
  };

  if (params.statusBetslip) filter.status_betslip = params.statusBetslip;

  if (params.startDate || params.endDate) {
    filter.createdAt = {};
    if (params.startDate) filter.createdAt.$gte = new Date(params.startDate);
    if (params.endDate) filter.createdAt.$lte = new Date(params.endDate);
  }

  const limit = Math.min(params.limit || 50, 200);

  const transactions = await db
    .collection('betbytransactions')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  // Get unique betslip IDs and fetch betslip details
  const betslipIds = [
    ...new Set(
      transactions
        .map((t: any) => t.betslip)
        .filter(Boolean)
        .map(String)
    ),
  ];

  let betslips: any[] = [];
  if (betslipIds.length > 0) {
    betslips = await db
      .collection('betbybetslips')
      .find({
        _id: {
          $in: betslipIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
      })
      .toArray();
  }

  const total = await db.collection('betbytransactions').countDocuments(filter);

  return { transactions, betslips, total };
}

import mongoose from 'mongoose';
import { getConnection } from '../db.js';

interface GetUserReferralsParams {
  userId: string;
  limit?: number;
}

export async function getUserReferrals(params: GetUserReferralsParams) {
  const db = (await getConnection()).db!;

  const userOid = new mongoose.Types.ObjectId(params.userId);
  const limit = Math.min(params.limit || 50, 200);

  // Get user's referral data
  const user = await db.collection('users').findOne(
    { _id: userOid },
    {
      projection: {
        referral: 1,
        referralCode: 1,
        referrerId: 1,
        name: 1,
      },
    }
  );

  // Get referral deposits (deposits made by users this person referred)
  const referralDeposits = await db
    .collection('referraldeposits')
    .find({ referrerUser: userOid })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  // Get referral claim history
  const claimHistory = await db
    .collection('referralclaimhistories')
    .find({ userId: userOid })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  return {
    referralInfo: user ? {
      code: user.referral?.code,
      message: user.referral?.message,
      availableGems: user.referral?.availableGems,
      generatedRevenue: user.referral?.generatedRevenue,
      totalDepositedGems: user.referral?.totalDepositedGems,
      referredUserCount: user.referral?.users?.length || 0,
      referredBy: user.referralCode || null,
      referrerId: user.referrerId || null,
    } : null,
    referralDeposits,
    claimHistory,
  };
}

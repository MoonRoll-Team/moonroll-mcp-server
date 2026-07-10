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

  // Referral data lives on `userreferrals` after the DDD user split; fall
  // back to the legacy embedded users copy for databases that predate the
  // split (the frozen copy is $unset once the split has run).
  const referralRow = await db.collection('userreferrals').findOne(
    { userId: userOid },
    {
      projection: {
        referral: 1,
        referralCode: 1,
        referrerId: 1,
      },
    }
  );

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

  const referralSource = referralRow ?? user;

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
    referralInfo: referralSource ? {
      code: referralSource.referral?.code,
      message: referralSource.referral?.message,
      availableGems: referralSource.referral?.availableGems,
      generatedRevenue: referralSource.referral?.generatedRevenue,
      totalDepositedGems: referralSource.referral?.totalDepositedGems,
      referredUserCount: referralSource.referral?.users?.length || 0,
      referredBy: referralSource.referralCode || null,
      referrerId: referralSource.referrerId || null,
    } : null,
    referralDeposits,
    claimHistory,
  };
}

import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { SENSITIVE_PROJECTION } from '../redact.js';

const SENSITIVE_FIELDS = SENSITIVE_PROJECTION;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findUser(query: string) {
  const db = (await getConnection()).db!;
  const users = db.collection('users');
  const userbalances = db.collection('userbalances');

  let user = null;

  // 1. Try ObjectId
  if (mongoose.Types.ObjectId.isValid(query) && query.length === 24) {
    user = await users.findOne(
      { _id: new mongoose.Types.ObjectId(query) },
      { projection: SENSITIVE_FIELDS }
    );
  }

  // 2. Try publicId
  if (!user) {
    user = await users.findOne(
      { publicId: query },
      { projection: SENSITIVE_FIELDS }
    );
  }

  // 3. Try email (case-insensitive)
  if (!user) {
    user = await users.findOne(
      { email: { $regex: `^${escapeRegex(query)}$`, $options: 'i' } },
      { projection: SENSITIVE_FIELDS }
    );
  }

  // 4. Try name (case-insensitive)
  if (!user) {
    user = await users.findOne(
      { name: { $regex: `^${escapeRegex(query)}$`, $options: 'i' } },
      { projection: SENSITIVE_FIELDS }
    );
  }

  // 5. Try discordId
  if (!user) {
    user = await users.findOne(
      { discordId: query },
      { projection: SENSITIVE_FIELDS }
    );
  }

  // 6. Try wallet addresses
  if (!user) {
    user = await users.findOne(
      {
        $or: [
          { publicAddress: query },
          { 'cryptoAddresses.solPublicAddress': query },
          { magicPublicAddress: query },
        ],
      },
      { projection: SENSITIVE_FIELDS }
    );
  }

  if (!user) {
    return { found: false, message: `No user found matching "${query}"` };
  }

  // Fetch balance
  const balance = await userbalances.findOne({ userId: user._id });

  return {
    found: true,
    user,
    balance: balance || null,
  };
}

// Helper used by other tools to resolve a search string to an ObjectId
export async function resolveUserId(
  query: string
): Promise<{ userId: string; userName: string } | null> {
  const result = await findUser(query);
  if (!result.found || !result.user) return null;
  return {
    userId: String(result.user._id),
    userName: (result.user as any).name || '',
  };
}

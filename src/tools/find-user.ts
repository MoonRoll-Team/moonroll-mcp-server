import mongoose from 'mongoose';
import { getConnection } from '../db.js';
import { SENSITIVE_PROJECTION } from '../redact.js';

const SENSITIVE_FIELDS = SENSITIVE_PROJECTION;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// All identifier interpretations are tried in a single $or query (one network
// roundtrip instead of up to six sequential lookups); when several users match,
// the most specific interpretation wins via matchPriority.
function matchPriority(u: any, query: string, oid: mongoose.Types.ObjectId | null): number {
  const lower = query.toLowerCase();
  if (oid && String(u._id) === String(oid)) return 0;
  if (u.publicId === query) return 1;
  if (typeof u.email === 'string' && u.email.toLowerCase() === lower) return 2;
  if (typeof u.name === 'string' && u.name.toLowerCase() === lower) return 3;
  if (u.discordId === query) return 4;
  return 5; // wallet address match
}

// Resolve an identifier to the full user document (sensitive fields stripped).
export async function findUserDoc(query: string): Promise<any | null> {
  const db = (await getConnection()).db!;
  const users = db.collection('users');

  const oid =
    mongoose.Types.ObjectId.isValid(query) && query.length === 24
      ? new mongoose.Types.ObjectId(query)
      : null;
  const exact = { $regex: `^${escapeRegex(query)}$`, $options: 'i' };

  const or: any[] = [
    { publicId: query },
    { email: exact },
    { name: exact },
    { discordId: query },
    { publicAddress: query },
    { 'cryptoAddresses.solPublicAddress': query },
    { magicPublicAddress: query },
  ];
  if (oid) or.unshift({ _id: oid });

  const candidates = await users
    .find({ $or: or }, { projection: SENSITIVE_FIELDS })
    .limit(5)
    .toArray();
  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => matchPriority(a, query, oid) - matchPriority(b, query, oid)
  );
  return candidates[0];
}

export async function findUser(query: string) {
  const user = await findUserDoc(query);
  if (!user) {
    return { found: false, message: `No user found matching "${query}"` };
  }

  const db = (await getConnection()).db!;
  const balance = await db.collection('userbalances').findOne({ userId: user._id });

  return {
    found: true,
    user,
    balance: balance || null,
  };
}

// Helper used by other tools to resolve a search string (ObjectId, publicId,
// username, email, wallet address, or Discord ID) to the user's identifiers.
// Single roundtrip — does not fetch the balance.
export async function resolveUserId(
  query: string
): Promise<{ userId: string; userName: string; publicId: string | null } | null> {
  const user = await findUserDoc(query);
  if (!user) return null;
  return {
    userId: String(user._id),
    userName: user.name || '',
    publicId: user.publicId || null,
  };
}

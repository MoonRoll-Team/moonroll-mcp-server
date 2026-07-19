import mongoose from 'mongoose';

// Cap for countDocuments calls: an uncapped count on bets/ledgers scans
// millions of docs and can take seconds. Past the cap the true total is
// unknown, so results carry totalCapped instead of a misleading number.
export const COUNT_CAP = 1000;

export function capCount(total: number): { total: number; totalCapped?: true } {
  return total >= COUNT_CAP ? { total, totalCapped: true } : { total };
}

let connection: mongoose.Connection | null = null;
let connectingPromise: Promise<mongoose.Connection> | null = null;

export async function getConnection(): Promise<mongoose.Connection> {
  if (connection && connection.readyState === 1) {
    return connection;
  }

  // Avoid multiple concurrent connection attempts
  if (connectingPromise) {
    return connectingPromise;
  }

  const url = process.env.MONGODB_URL;
  if (!url) {
    throw new Error('MONGODB_URL environment variable is required');
  }

  connectingPromise = (async () => {
    try {
      connection = mongoose.createConnection(url, {
        // Tools batch parallel queries (find + count, multi-collection
        // Promise.all) — a pool of 2 serializes them again.
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
      });
      await connection.asPromise();
      console.error('[moonroll-mcp] Connected to MongoDB');
      return connection;
    } catch (err) {
      // Reset so the next tool call retries instead of reusing the rejected promise forever.
      connection = null;
      connectingPromise = null;
      throw err;
    }
  })();

  return connectingPromise;
}

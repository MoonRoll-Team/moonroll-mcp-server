import mongoose from 'mongoose';

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
        maxPoolSize: 2,
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

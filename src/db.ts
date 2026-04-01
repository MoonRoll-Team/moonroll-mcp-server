import mongoose from 'mongoose';

let connection: mongoose.Connection | null = null;

export async function connect(): Promise<mongoose.Connection> {
  const url = process.env.MONGODB_URL;
  if (!url) {
    throw new Error('MONGODB_URL environment variable is required');
  }

  if (connection && connection.readyState === 1) {
    return connection;
  }

  connection = mongoose.createConnection(url, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

  await connection.asPromise();
  console.error(`[moonroll-mcp] Connected to MongoDB`);
  return connection;
}

export function getConnection(): mongoose.Connection {
  if (!connection || connection.readyState !== 1) {
    throw new Error('MongoDB not connected. Call connect() first.');
  }
  return connection;
}

import { getConnection } from '../db.js';

// Collections that must never be queried (contain admin credentials)
const BLOCKED_COLLECTIONS = new Set(['adminusers']);

// Sensitive fields to strip from user-related collections
const SENSITIVE_PROJECTIONS: Record<string, Record<string, 0>> = {
  users: {
    password: 0,
    nonce: 0,
    'cryptoAddresses.pkSol': 0,
    intercomHash: 0,
  },
};

// Aggregate stages that could write data
const BLOCKED_AGGREGATE_STAGES = new Set(['$out', '$merge']);

const ALLOWED_METHODS = ['find', 'findOne', 'countDocuments', 'aggregate'] as const;
type AllowedMethod = (typeof ALLOWED_METHODS)[number];

interface RunQueryParams {
  collection: string;
  method: string;
  filter: string;
  projection?: string;
  sort?: string;
  limit?: number;
  skip?: number;
}

export async function runQuery(params: RunQueryParams) {
  const collectionName = params.collection.toLowerCase();

  // Validate collection
  if (BLOCKED_COLLECTIONS.has(collectionName)) {
    return { error: `Collection "${collectionName}" is not accessible` };
  }

  // Validate method
  if (!ALLOWED_METHODS.includes(params.method as AllowedMethod)) {
    return {
      error: `Method "${params.method}" is not allowed. Use: ${ALLOWED_METHODS.join(', ')}`,
    };
  }

  const method = params.method as AllowedMethod;

  // Parse filter/pipeline
  let filter: any;
  try {
    filter = JSON.parse(params.filter);
  } catch {
    return { error: 'Invalid JSON in filter parameter' };
  }

  // For aggregate, validate pipeline stages
  if (method === 'aggregate') {
    if (!Array.isArray(filter)) {
      return { error: 'Aggregate filter must be a JSON array (pipeline)' };
    }
    for (const stage of filter) {
      const stageKeys = Object.keys(stage);
      for (const key of stageKeys) {
        if (BLOCKED_AGGREGATE_STAGES.has(key)) {
          return { error: `Aggregate stage "${key}" is not allowed (write operation)` };
        }
      }
    }
  }

  const db = (await getConnection()).db!;

  // Check collection exists
  const collections = await db
    .listCollections({ name: collectionName })
    .toArray();
  if (collections.length === 0) {
    return { error: `Collection "${collectionName}" not found` };
  }

  const collection = db.collection(collectionName);

  // Apply sensitive field projection
  let projection: any = params.projection ? JSON.parse(params.projection) : {};
  if (SENSITIVE_PROJECTIONS[collectionName]) {
    projection = { ...projection, ...SENSITIVE_PROJECTIONS[collectionName] };
  }

  const limit = Math.min(params.limit || 20, 100);
  const skip = params.skip || 0;

  let sort: any = undefined;
  if (params.sort) {
    try {
      sort = JSON.parse(params.sort);
    } catch {
      return { error: 'Invalid JSON in sort parameter' };
    }
  }

  switch (method) {
    case 'find': {
      const cursor = collection.find(filter, { projection });
      if (sort) cursor.sort(sort);
      const results = await cursor.skip(skip).limit(limit).toArray();
      const total = await collection.countDocuments(filter);
      return { results, total, limit, skip };
    }

    case 'findOne': {
      const result = await collection.findOne(filter, { projection });
      return { result };
    }

    case 'countDocuments': {
      const count = await collection.countDocuments(filter);
      return { count };
    }

    case 'aggregate': {
      // Inject limit at end if not already present
      const pipeline = [...filter];
      const hasLimit = pipeline.some((s: any) => '$limit' in s);
      if (!hasLimit) {
        pipeline.push({ $limit: limit });
      }
      const results = await collection.aggregate(pipeline).toArray();
      return { results };
    }
  }
}

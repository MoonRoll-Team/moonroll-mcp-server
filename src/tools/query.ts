import { EJSON } from 'bson';
import { getConnection, COUNT_CAP, capCount } from '../db.js';
import { SENSITIVE_PROJECTION } from '../redact.js';

// Parse Extended JSON so {"$oid": "..."} and {"$date": "..."} work in filters.
// Relaxed mode keeps plain numbers as JS numbers.
function parseEJSON(text: string): any {
  return EJSON.parse(text, { relaxed: true });
}

// Collection-name cache (60s TTL) — avoids a listCollections roundtrip on
// every run_query call. A collection created mid-TTL appears within a minute.
const COLLECTIONS_TTL_MS = 60_000;
let collectionsCache: { names: Set<string>; at: number } | null = null;

async function collectionExists(db: any, name: string): Promise<boolean> {
  if (!collectionsCache || Date.now() - collectionsCache.at > COLLECTIONS_TTL_MS) {
    const list = await db.listCollections().toArray();
    collectionsCache = {
      names: new Set(list.map((c: any) => c.name.toLowerCase())),
      at: Date.now(),
    };
  }
  return collectionsCache.names.has(name);
}

// Collections that must never be queried (contain admin credentials)
const BLOCKED_COLLECTIONS = new Set(['adminusers']);

// Sensitive fields to strip from user-related collections
const SENSITIVE_PROJECTIONS: Record<string, Record<string, 0>> = {
  users: SENSITIVE_PROJECTION,
};

// Operators forbidden anywhere in a filter or pipeline: writes ($out/$merge)
// and server-side JavaScript execution ($where/$function/$accumulator).
const FORBIDDEN_OPERATORS = new Set([
  '$out',
  '$merge',
  '$where',
  '$function',
  '$accumulator',
]);

// Recursively scan a filter or pipeline for forbidden operators and for
// references to blocked collections ($lookup/$unionWith/$graphLookup can pull
// in another collection regardless of the top-level collection being queried).
function scanForbidden(node: any): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const err = scanForbidden(item);
      if (err) return err;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;

  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_OPERATORS.has(key)) {
      return `Operator "${key}" is not allowed`;
    }
    if (key === '$lookup' || key === '$graphLookup') {
      const from = (value as any)?.from;
      if (typeof from === 'string' && BLOCKED_COLLECTIONS.has(from.toLowerCase())) {
        return `${key} into "${from}" is not allowed`;
      }
    }
    if (key === '$unionWith') {
      const coll = typeof value === 'string' ? value : (value as any)?.coll;
      if (typeof coll === 'string' && BLOCKED_COLLECTIONS.has(coll.toLowerCase())) {
        return `$unionWith "${coll}" is not allowed`;
      }
    }
    const err = scanForbidden(value);
    if (err) return err;
  }
  return null;
}

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
    filter = parseEJSON(params.filter);
  } catch {
    return { error: 'Invalid JSON in filter parameter' };
  }

  // For aggregate, the filter must be a pipeline array
  if (method === 'aggregate' && !Array.isArray(filter)) {
    return { error: 'Aggregate filter must be a JSON array (pipeline)' };
  }

  // Reject forbidden operators and blocked-collection references at any depth
  const forbidden = scanForbidden(filter);
  if (forbidden) {
    return { error: forbidden };
  }

  const db = (await getConnection()).db!;

  // Check collection exists (cached — saves a listCollections roundtrip per call)
  if (!(await collectionExists(db, collectionName))) {
    return { error: `Collection "${collectionName}" not found` };
  }

  const collection = db.collection(collectionName);

  // Apply sensitive field projection
  let projection: any = {};
  if (params.projection) {
    try {
      projection = parseEJSON(params.projection);
    } catch {
      return { error: 'Invalid JSON in projection parameter' };
    }
  }
  const sensitive = SENSITIVE_PROJECTIONS[collectionName];
  if (sensitive) {
    const isInclusion = Object.entries(projection).some(
      ([k, v]) => k !== '_id' && v
    );
    if (isInclusion) {
      // Mixing exclusions into an inclusion projection is a MongoDB error —
      // instead drop any attempt to include a sensitive field (and output
      // redaction catches anything nested that slips through).
      for (const key of Object.keys(sensitive)) delete projection[key];
    } else {
      projection = { ...projection, ...sensitive };
    }
  }

  const limit = Math.min(params.limit || 20, 100);
  const skip = params.skip || 0;

  let sort: any = undefined;
  if (params.sort) {
    try {
      sort = parseEJSON(params.sort);
    } catch {
      return { error: 'Invalid JSON in sort parameter' };
    }
  }

  switch (method) {
    case 'find': {
      const cursor = collection.find(filter, { projection });
      if (sort) cursor.sort(sort);
      const results = await cursor.skip(skip).limit(limit).toArray();
      const total = await collection.countDocuments(filter, { limit: COUNT_CAP });
      return { results, ...capCount(total), limit, skip };
    }

    case 'findOne': {
      const result = await collection.findOne(filter, { projection, sort });
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

import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { resolveUserId } from './find-user.js';

interface ParsedLogEntry {
  timestamp: number;
  level: string;
  ecsTaskId: string | null;
  requestId: string | null;
  userId: string | null;
  message: string;
  metadata: string | null;
}

function getClient() {
  return new CloudWatchLogsClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  });
}

function parseLogMessage(rawMessage: string, timestamp: number): ParsedLogEntry {
  try {
    const parsed = JSON.parse(rawMessage);
    if (typeof parsed === 'object' && parsed !== null) {
      const {
        message,
        level,
        timestamp: logTimestamp,
        requestId,
        userId,
        ecsTaskId,
        ...rest
      } = parsed;

      return {
        timestamp: logTimestamp ? new Date(logTimestamp).getTime() : timestamp,
        level: (level || 'unknown').toLowerCase(),
        ecsTaskId: ecsTaskId || null,
        requestId: requestId || null,
        userId: userId || null,
        message: message || '',
        metadata: Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
      };
    }
  } catch {
    // Not JSON
  }

  return {
    timestamp,
    level: 'unknown',
    ecsTaskId: null,
    requestId: null,
    userId: null,
    message: rawMessage,
    metadata: null,
  };
}

interface SearchLogsParams {
  searchType: 'user' | 'traceId';
  searchValue: string;
  startTime: string;
  endTime: string;
  logLevels?: string;
  limit?: number;
}

export async function searchLogs(params: SearchLogsParams) {
  const logGroupName = process.env.AWS_CLOUDWATCH_LOG_GROUP;
  if (!logGroupName) {
    return { error: 'AWS_CLOUDWATCH_LOG_GROUP not configured' };
  }

  const start = new Date(params.startTime).getTime();
  const end = new Date(params.endTime).getTime();

  if (isNaN(start) || isNaN(end)) {
    return { error: 'Invalid startTime or endTime format' };
  }

  // Filter by log levels
  const allowedLevels = (params.logLevels || 'error,warn,info')
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);

  // Build filter pattern — levels are filtered server-side so we don't page
  // through (and pay for) log events that would be discarded client-side.
  // Events without a level field still match ($.level NOT EXISTS) and are
  // kept by the client-side net below as level "unknown".
  const levelClause = allowedLevels
    .flatMap((l) => [l, l.toUpperCase()])
    .map((l) => `$.level = "${l}"`)
    .concat('$.level NOT EXISTS')
    .join(' || ');

  let filterPattern: string;
  let resolvedUser: { userId: string; userName: string } | null = null;

  if (params.searchType === 'user') {
    resolvedUser = await resolveUserId(params.searchValue.trim());
    if (!resolvedUser) {
      return { error: `No user found matching "${params.searchValue}"` };
    }
    filterPattern = `{ $.userId = "${resolvedUser.userId}" && (${levelClause}) }`;
  } else {
    filterPattern = `{ $.requestId = "${params.searchValue.trim()}" && (${levelClause}) }`;
  }

  const limit = Math.min(params.limit || 100, 500);

  const client = getClient();

  // FilterLogEvents only scans a slice of the time range per call; without following
  // nextToken a sparse match can come back empty even though events exist later in the
  // range. Walk pages until we have enough matches or the range is fully scanned.
  const MAX_PAGES = 40;
  const events: { message?: string; timestamp?: number }[] = [];
  let nextToken: string | undefined;
  let pagesScanned = 0;

  do {
    const result: { events?: typeof events; nextToken?: string } = await client.send(
      new FilterLogEventsCommand({
        logGroupName,
        filterPattern,
        startTime: start,
        endTime: end,
        limit,
        nextToken,
      })
    );
    events.push(...(result.events || []));
    nextToken = result.nextToken;
    pagesScanned++;
  } while (nextToken && events.length < limit && pagesScanned < MAX_PAGES);

  const logs = events
    .slice(0, limit)
    .map((event) => parseLogMessage(event.message || '', event.timestamp || 0));

  // Client-side net: keeps behavior identical for non-JSON events (level "unknown")
  const filteredLogs = logs.filter(
    (log) => allowedLevels.includes(log.level) || log.level === 'unknown'
  );

  return {
    logs: filteredLogs,
    resolvedUser,
    total: filteredLogs.length,
    hasMore: !!nextToken,
    pagesScanned,
  };
}

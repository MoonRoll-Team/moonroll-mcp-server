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

  // Build filter pattern
  let filterPattern: string;
  let resolvedUser: { userId: string; userName: string } | null = null;

  if (params.searchType === 'user') {
    resolvedUser = await resolveUserId(params.searchValue.trim());
    if (!resolvedUser) {
      return { error: `No user found matching "${params.searchValue}"` };
    }
    filterPattern = `{ $.userId = "${resolvedUser.userId}" }`;
  } else {
    filterPattern = `{ $.requestId = "${params.searchValue.trim()}" }`;
  }

  const limit = Math.min(params.limit || 100, 500);

  const client = getClient();
  const command = new FilterLogEventsCommand({
    logGroupName,
    filterPattern,
    startTime: start,
    endTime: end,
    limit,
  });

  const result = await client.send(command);

  const logs = (result.events || []).map((event) =>
    parseLogMessage(event.message || '', event.timestamp || 0)
  );

  // Filter by log levels
  const allowedLevels = (params.logLevels || 'error,warn,info')
    .split(',')
    .map((l) => l.trim().toLowerCase());

  const filteredLogs = logs.filter(
    (log) => allowedLevels.includes(log.level) || log.level === 'unknown'
  );

  return {
    logs: filteredLogs,
    resolvedUser,
    total: filteredLogs.length,
    hasMore: !!result.nextToken,
  };
}

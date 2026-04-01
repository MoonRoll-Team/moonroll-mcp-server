import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { connect } from './db.js';
import { findUser } from './tools/find-user.js';
import { getUserBets } from './tools/user-bets.js';
import { getUserLedger } from './tools/user-ledger.js';
import { getUserSessions } from './tools/user-sessions.js';
import { searchLogs } from './tools/search-logs.js';
import { runQuery } from './tools/query.js';

dotenv.config();

const server = new McpServer({
  name: 'moonroll-debug',
  version: '1.0.0',
});

// --- Tool: find_user ---
server.tool(
  'find_user',
  'Look up a Moonroll user by any identifier: ObjectId, publicId, name, email, wallet address, or Discord ID. Returns user profile and balance.',
  {
    query: z
      .string()
      .describe(
        'The search value — ObjectId, publicId, username, email, wallet address, or Discord ID'
      ),
  },
  async ({ query }) => {
    try {
      const result = await findUser(query);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Tool: get_user_bets ---
server.tool(
  'get_user_bets',
  'Retrieve a user\'s betting history with optional filters. Useful for investigating suspicious wins or unusual patterns.',
  {
    userId: z.string().describe('User ObjectId'),
    gameType: z
      .string()
      .optional()
      .describe(
        'Filter by game type: dice, mines, plinko, slots, limbo, blackjack, lootbox, battle, jackpot, crash, etc.'
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Filter by status: pending, completed, failed, cancelled, refunded'
      ),
    currency: z
      .string()
      .optional()
      .describe('Filter by currency: gems or moonrollcoins'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    minProfit: z
      .number()
      .optional()
      .describe('Minimum profit threshold (useful for finding big wins)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  async (params) => {
    try {
      const result = await getUserBets(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Tool: get_user_ledger ---
server.tool(
  'get_user_ledger',
  'Retrieve all balance-changing operations for a user (bets, deposits, withdrawals, bonuses). Shows balanceAfter for each entry — the most useful tool for tracing balance anomalies and exploits.',
  {
    userId: z.string().describe('User ObjectId'),
    operation: z
      .string()
      .optional()
      .describe(
        'Filter by operation type: bet-place, bet-win, deposit, withdraw, bonus, tip, swap, etc.'
      ),
    currency: z
      .string()
      .optional()
      .describe('Filter by currency: USD, MRC, etc.'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  async (params) => {
    try {
      const result = await getUserLedger(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Tool: get_user_sessions ---
server.tool(
  'get_user_sessions',
  'Retrieve login history or IP history for a user. Useful for multi-accounting detection and security investigations.',
  {
    userId: z.string().describe('User ObjectId'),
    type: z
      .enum(['login', 'ip'])
      .optional()
      .describe(
        'Type of history: "login" for login events (default), "ip" for IP address history'
      ),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  async (params) => {
    try {
      const result = await getUserSessions(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Tool: search_logs ---
server.tool(
  'search_logs',
  'Search CloudWatch logs by user identifier or trace/request ID. Logs include level, message, userId, requestId, and metadata.',
  {
    searchType: z
      .enum(['user', 'traceId'])
      .describe(
        '"user" to search by user (name, ID, email, etc.) or "traceId" to search by requestId'
      ),
    searchValue: z
      .string()
      .describe(
        'The user identifier (will be resolved to ObjectId) or the requestId value'
      ),
    startTime: z.string().describe('Start time (ISO format)'),
    endTime: z.string().describe('End time (ISO format)'),
    logLevels: z
      .string()
      .optional()
      .describe(
        'Comma-separated log levels to include (default: "error,warn,info")'
      ),
    limit: z
      .number()
      .optional()
      .describe('Max number of log events (default 100, max 500)'),
  },
  async (params) => {
    try {
      const result = await searchLogs(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Tool: run_query ---
server.tool(
  'run_query',
  'Run a read-only MongoDB query on any collection. Supports find, findOne, countDocuments, and aggregate. The "adminusers" collection is blocked. Sensitive fields are automatically stripped from user queries.',
  {
    collection: z.string().describe('Collection name (e.g. "users", "bets", "ledgers", "tradings")'),
    method: z
      .enum(['find', 'findOne', 'countDocuments', 'aggregate'])
      .describe('Query method'),
    filter: z
      .string()
      .describe(
        'JSON string — MongoDB filter object for find/findOne/countDocuments, or pipeline array for aggregate'
      ),
    projection: z
      .string()
      .optional()
      .describe('JSON string — field projection (e.g. {"name":1,"email":1})'),
    sort: z
      .string()
      .optional()
      .describe('JSON string — sort specification (e.g. {"createdAt":-1})'),
    limit: z
      .number()
      .optional()
      .describe('Max results (default 20, max 100)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  async (params) => {
    try {
      const result = await runQuery(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Start server ---
async function main() {
  await connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[moonroll-mcp] Server started');
}

main().catch((err) => {
  console.error('[moonroll-mcp] Fatal error:', err);
  process.exit(1);
});

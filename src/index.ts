import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConnection } from './db.js';
import { findUser } from './tools/find-user.js';
import { getUserBets } from './tools/user-bets.js';
import { getUserLedger } from './tools/user-ledger.js';
import { getUserSessions } from './tools/user-sessions.js';
import { searchLogs } from './tools/search-logs.js';
import { runQuery } from './tools/query.js';
import { getUserTradings } from './tools/user-tradings.js';
import { getUserWithdrawals } from './tools/user-withdrawals.js';
import { getUserBonuses } from './tools/user-bonuses.js';
import { getUserSportsBets } from './tools/user-sports-bets.js';
import { getUserSportsActivity } from './tools/user-sports-activity.js';
import { getUserDailyStats } from './tools/user-daily-stats.js';
import { getUserReferrals } from './tools/user-referrals.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const server = new McpServer({
  name: 'moonroll-debug',
  version: '1.0.0',
});

// Helper to wrap tool handlers
function toolHandler(fn: (params: any) => Promise<any>) {
  return async (params: any) => {
    try {
      const result = await fn(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  };
}

// --- Tool: find_user ---
server.tool(
  'find_user',
  'Look up a Moonroll user by any identifier: ObjectId, publicId, name, email, wallet address, or Discord ID. Returns user profile and balance.',
  {
    query: z.string().describe('The search value — ObjectId, publicId, username, email, wallet address, or Discord ID'),
  },
  toolHandler(({ query }) => findUser(query))
);

// --- Tool: get_user_bets ---
server.tool(
  'get_user_bets',
  'Retrieve a user\'s betting history with optional filters. Useful for investigating suspicious wins or unusual patterns.',
  {
    userId: z.string().describe('User ObjectId'),
    gameType: z.string().optional().describe('Filter by game type: dice, mines, plinko, slots, limbo, blackjack, lootbox, battle, jackpot, crash, etc.'),
    status: z.string().optional().describe('Filter by status: pending, completed, failed, cancelled, refunded'),
    currency: z.string().optional().describe('Filter by currency: gems or moonrollcoins'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    minProfit: z.number().optional().describe('Minimum profit threshold (useful for finding big wins)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  toolHandler(getUserBets)
);

// --- Tool: get_user_ledger ---
server.tool(
  'get_user_ledger',
  'Retrieve all balance-changing operations for a user (bets, deposits, withdrawals, bonuses). Shows balanceAfter for each entry — the most useful tool for tracing balance anomalies and exploits.',
  {
    userId: z.string().describe('User ObjectId'),
    operation: z.string().optional().describe('Filter by operation type: bet-place, bet-win, deposit, withdraw, bonus, tip, swap, etc.'),
    currency: z.string().optional().describe('Filter by currency: USD, MRC, etc.'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  toolHandler(getUserLedger)
);

// --- Tool: get_user_sessions ---
server.tool(
  'get_user_sessions',
  'Retrieve login history or IP history for a user. Useful for multi-accounting detection and security investigations.',
  {
    userId: z.string().describe('User ObjectId'),
    type: z.enum(['login', 'ip']).optional().describe('Type of history: "login" for login events (default), "ip" for IP address history'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  toolHandler(getUserSessions)
);

// --- Tool: search_logs ---
server.tool(
  'search_logs',
  'Search CloudWatch logs by user identifier or trace/request ID. Logs include level, message, userId, requestId, and metadata.',
  {
    searchType: z.enum(['user', 'traceId']).describe('"user" to search by user (name, ID, email, etc.) or "traceId" to search by requestId'),
    searchValue: z.string().describe('The user identifier (will be resolved to ObjectId) or the requestId value'),
    startTime: z.string().describe('Start time (ISO format)'),
    endTime: z.string().describe('End time (ISO format)'),
    logLevels: z.string().optional().describe('Comma-separated log levels to include (default: "error,warn,info")'),
    limit: z.number().optional().describe('Max number of log events (default 100, max 500)'),
  },
  toolHandler(searchLogs)
);

// --- Tool: run_query ---
server.tool(
  'run_query',
  'Run a read-only MongoDB query on any collection. Supports find, findOne, countDocuments, and aggregate. The "adminusers" collection is blocked. Sensitive fields are automatically stripped from user queries.',
  {
    collection: z.string().describe('Collection name (e.g. "users", "bets", "ledgers", "tradings")'),
    method: z.enum(['find', 'findOne', 'countDocuments', 'aggregate']).describe('Query method'),
    filter: z.string().describe('JSON string — MongoDB filter object for find/findOne/countDocuments, or pipeline array for aggregate'),
    projection: z.string().optional().describe('JSON string — field projection (e.g. {"name":1,"email":1})'),
    sort: z.string().optional().describe('JSON string — sort specification (e.g. {"createdAt":-1})'),
    limit: z.number().optional().describe('Max results (default 20, max 100)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  toolHandler(runQuery)
);

// --- Tool: get_user_tradings ---
server.tool(
  'get_user_tradings',
  'Retrieve deposit/withdrawal trading records for a user. Shows blockchain transactions with status, amounts, and signatures.',
  {
    userId: z.string().describe('User ObjectId'),
    action: z.string().optional().describe('Filter by action: DEPOSIT_SOL, DEPOSIT_ETH, DEPOSIT_BTC, DEPOSIT_LTC, DEPOSIT_MRC, DEPOSIT_SPL, WITHDRAW_SOL, WITHDRAW_ETH, WITHDRAW_BTC, WITHDRAW_LTC, etc.'),
    status: z.string().optional().describe('Filter by status: success, failed, pending'),
    blockchain: z.string().optional().describe('Filter by blockchain'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  toolHandler(getUserTradings)
);

// --- Tool: get_user_withdrawals ---
server.tool(
  'get_user_withdrawals',
  'Get pending and failed withdrawals for a user. Returns both pending requests and failed withdrawal records with failure reasons.',
  {
    userId: z.string().describe('User ObjectId'),
    status: z.string().optional().describe('Filter pending withdrawals by status'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results per category (default 50, max 200)'),
  },
  toolHandler(getUserWithdrawals)
);

// --- Tool: get_user_bonuses ---
server.tool(
  'get_user_bonuses',
  'Get bonus history and current eligibility for a user. Shows claimed bonuses and active bonus templates the user can use.',
  {
    userId: z.string().describe('User ObjectId'),
    type: z.string().optional().describe('Filter by bonus type'),
    currency: z.string().optional().describe('Filter by currency: USD, MRC'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  toolHandler(getUserBonuses)
);

// --- Tool: get_user_sports_bets ---
server.tool(
  'get_user_sports_bets',
  'Get current BetConstruct sports betting transactions for a user. Resolves ObjectId/publicId/name/email to the sports publicId and returns related transactions by betId.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, or email'),
    operation: z.string().optional().describe('Filter by BetConstruct operation: bet_placed, bet_resulted, or rollback'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of transactions to return (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset for transactions (default 0)'),
  },
  toolHandler(getUserSportsBets)
);

// --- Tool: get_user_sports_activity ---
server.tool(
  'get_user_sports_activity',
  'Read sports betting activity for a user from the current BetConstruct records. Returns transactions, related records grouped by betId, counts, and summaries.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, or email'),
    include: z.string().optional().describe('Comma-separated sections: summary,transactions,bets. Default includes all.'),
    operation: z.string().optional().describe('Filter by BetConstruct operation: bet_placed, bet_resulted, or rollback'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of transactions to return (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset for transactions (default 0)'),
  },
  toolHandler(getUserSportsActivity)
);

// --- Tool: get_user_daily_stats ---
server.tool(
  'get_user_daily_stats',
  'Get daily P&L breakdown for a user. Shows wagered, won, income, deposits, and withdrawals per day per currency per game type.',
  {
    userId: z.string().describe('User ObjectId'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of days (default 30, max 90)'),
  },
  toolHandler(getUserDailyStats)
);

// --- Tool: get_user_referrals ---
server.tool(
  'get_user_referrals',
  'Get referral info for a user — referral code, revenue generated, referred users, referral deposits, and claim history.',
  {
    userId: z.string().describe('User ObjectId'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  toolHandler(getUserReferrals)
);

// --- Tool: list_collections ---
server.tool(
  'list_collections',
  'List all available MongoDB collections with document counts. Useful for discovering what data is available.',
  {},
  async () => {
    try {
      const db = (await getConnection()).db!;
      const collections = await db.listCollections().toArray();
      const results = await Promise.all(
        collections
          .filter((c) => c.name !== 'adminusers')
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (c) => {
            const count = await db.collection(c.name).estimatedDocumentCount();
            return { name: c.name, count };
          })
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// --- Start server ---
async function main() {
  const useHttp = process.env.MCP_PORT || process.argv.includes('--http');

  if (useHttp) {
    // HTTP mode — for deployment or `npm run dev:http`
    const app = express();
    app.use(express.json());
    const port = parseInt(process.env.MCP_PORT || '3456', 10);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    app.post('/mcp', async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    app.get('/mcp', async (req, res) => {
      await transport.handleRequest(req, res);
    });

    app.delete('/mcp', async (req, res) => {
      await transport.handleRequest(req, res);
    });

    await server.connect(transport);

    app.listen(port, () => {
      console.log(`[moonroll-mcp] HTTP server on http://localhost:${port}/mcp`);
      console.log(`[moonroll-mcp] 14 tools registered`);
    });
  } else {
    // stdio mode — for local Claude Code via .mcp.json
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[moonroll-mcp] stdio server started, 14 tools registered');
  }
}

main().catch((err) => {
  console.error('[moonroll-mcp] Fatal error:', err);
  process.exit(1);
});

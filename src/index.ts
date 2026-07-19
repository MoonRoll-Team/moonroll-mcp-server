import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConnection } from './db.js';
import { redactDeep } from './redact.js';
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
import { getDataDictionary } from './tools/data-dictionary.js';
import { checkWithdrawEligibility } from './tools/withdraw-eligibility.js';
import { getPlatformStats } from './tools/platform-stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Select which environment this server instance targets.
// MOONROLL_ENV=dev  -> loads .env.dev  and registers as "moonroll-debug-dev"
// anything else     -> loads .env      and registers as "moonroll-debug" (prod, default)
const targetEnv = (process.env.MOONROLL_ENV || 'prod').toLowerCase() === 'dev' ? 'dev' : 'prod';
const envFile = targetEnv === 'dev' ? '../.env.dev' : '../.env';
dotenv.config({ path: path.resolve(__dirname, envFile) });

const serverName = targetEnv === 'dev' ? 'moonroll-debug-dev' : 'moonroll-debug';

const server = new McpServer({
  name: serverName,
  version: '1.0.0',
});

// Helper to wrap tool handlers
function toolHandler(fn: (params: any) => Promise<any>) {
  return async (params: any) => {
    try {
      const result = redactDeep(await fn(params));
      // Compact JSON — indentation costs tokens on every response
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  };
}

// Every tool on this server is read-only; annotate so clients know.
let toolCount = 0;
function registerReadOnlyTool(
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  fn: (params: any) => Promise<any>
) {
  server.registerTool(
    name,
    { description, inputSchema, annotations: { readOnlyHint: true } },
    toolHandler(fn)
  );
  toolCount++;
}

// --- Tool: find_user ---
registerReadOnlyTool(
  'find_user',
  'Look up a Moonroll user by any identifier: ObjectId, publicId, name, email, wallet address, or Discord ID. Returns user profile and balance.',
  {
    query: z.string().describe('The search value — ObjectId, publicId, username, email, wallet address, or Discord ID'),
  },
  ({ query }) => findUser(query)
);

// --- Tool: get_user_bets ---
registerReadOnlyTool(
  'get_user_bets',
  'Retrieve a user\'s betting history with optional filters. Useful for investigating suspicious wins or unusual patterns.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    gameType: z.string().optional().describe('Filter by game type: dice, mines, plinko, slots, limbo, blackjack, lootbox, battle, jackpot, crash, etc.'),
    status: z.string().optional().describe('Filter by status: pending, completed, failed, cancelled, refunded'),
    currency: z.string().optional().describe('Filter by currency: gems or moonrollcoins'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    minProfit: z.number().optional().describe('Minimum profit threshold (useful for finding big wins)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
    full: z.boolean().optional().describe('Include per-game state details and provable-fairness seeds (default false: compact view)'),
  },
  getUserBets
);

// --- Tool: get_user_ledger ---
registerReadOnlyTool(
  'get_user_ledger',
  'Retrieve all balance-changing operations for a user (bets, deposits, withdrawals, bonuses). Shows balanceAfter for each entry — the most useful tool for tracing balance anomalies and exploits.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    operation: z.string().optional().describe('Filter by operation type: bet-place, bet-win, deposit, withdraw, bonus, tip, swap, etc.'),
    currency: z.string().optional().describe('Filter by currency: USD, MRC, etc.'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  getUserLedger
);

// --- Tool: get_user_sessions ---
registerReadOnlyTool(
  'get_user_sessions',
  'Retrieve login history or IP history for a user. Useful for multi-accounting detection and security investigations.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    type: z.enum(['login', 'ip']).optional().describe('Type of history: "login" for login events (default), "ip" for IP address history'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  getUserSessions
);

// --- Tool: search_logs ---
registerReadOnlyTool(
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
  searchLogs
);

// --- Tool: run_query ---
registerReadOnlyTool(
  'run_query',
  'Run a read-only MongoDB query on any collection. Supports find, findOne, countDocuments, and aggregate. Filters accept MongoDB Extended JSON: {"$oid":"..."} for ObjectIds and {"$date":"2026-07-01T00:00:00Z"} for dates — e.g. {"userId":{"$oid":"64..."},"createdAt":{"$gte":{"$date":"2026-07-01T00:00:00Z"}}}. The "adminusers" collection is blocked. Sensitive fields are automatically stripped from results.',
  {
    collection: z.string().describe('Collection name (e.g. "users", "bets", "ledgers", "tradings")'),
    method: z.enum(['find', 'findOne', 'countDocuments', 'aggregate']).describe('Query method'),
    filter: z.string().describe('JSON string — MongoDB filter object for find/findOne/countDocuments, or pipeline array for aggregate. Supports Extended JSON: {"$oid":"..."}, {"$date":"..."}'),
    projection: z.string().optional().describe('JSON string — field projection (e.g. {"name":1,"email":1})'),
    sort: z.string().optional().describe('JSON string — sort specification (e.g. {"createdAt":-1}); also applied to findOne'),
    limit: z.number().optional().describe('Max results (default 20, max 100)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  runQuery
);

// --- Tool: get_user_tradings ---
registerReadOnlyTool(
  'get_user_tradings',
  'Retrieve deposit/withdrawal trading records for a user. Shows blockchain transactions with status, amounts, and signatures.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    action: z.string().optional().describe('Filter by action: DEPOSIT_SOL, DEPOSIT_ETH, DEPOSIT_BTC, DEPOSIT_LTC, DEPOSIT_MRC, DEPOSIT_SPL, WITHDRAW_SOL, WITHDRAW_ETH, WITHDRAW_BTC, WITHDRAW_LTC, etc.'),
    status: z.string().optional().describe('Filter by status: success, failed, pending'),
    blockchain: z.string().optional().describe('Filter by blockchain'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
    skip: z.number().optional().describe('Pagination offset (default 0)'),
  },
  getUserTradings
);

// --- Tool: get_user_withdrawals ---
registerReadOnlyTool(
  'get_user_withdrawals',
  'Get pending and failed withdrawals for a user. Returns both pending requests and failed withdrawal records with failure reasons.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    status: z.string().optional().describe('Filter pending withdrawals by status'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results per category (default 50, max 200)'),
  },
  getUserWithdrawals
);

// --- Tool: get_user_bonuses ---
registerReadOnlyTool(
  'get_user_bonuses',
  'Get bonus history and current eligibility for a user. Shows claimed bonuses and active bonus templates the user can use.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    type: z.string().optional().describe('Filter by bonus type'),
    currency: z.string().optional().describe('Filter by currency: USD, MRC'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  getUserBonuses
);

// --- Tool: get_user_sports_bets ---
registerReadOnlyTool(
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
  getUserSportsBets
);

// --- Tool: get_user_sports_activity ---
registerReadOnlyTool(
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
  getUserSportsActivity
);

// --- Tool: get_user_daily_stats ---
registerReadOnlyTool(
  'get_user_daily_stats',
  'Get daily P&L breakdown for a user. Shows wagered, won, income, deposits, and withdrawals per day per currency per game type.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
    limit: z.number().optional().describe('Number of days (default 30, max 90)'),
  },
  getUserDailyStats
);

// --- Tool: get_user_referrals ---
registerReadOnlyTool(
  'get_user_referrals',
  'Get referral info for a user — referral code, revenue generated, referred users, referral deposits, and claim history.',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
    limit: z.number().optional().describe('Number of results (default 50, max 200)'),
  },
  getUserReferrals
);

// --- Tool: get_data_dictionary ---
registerReadOnlyTool(
  'get_data_dictionary',
  'Moonroll data dictionary: field semantics, state codes, and known pitfalls — gems are booked 1:1 to USD and inflate mixed totals ~8x, betState 4/3/2 = won/lost/void, per-collection user keys (userId vs requestedUser vs userPublicId), BO stats exclusion rules, withdrawal limit rules, run_query Extended JSON tips. Consult this before writing custom queries or interpreting financial figures.',
  {
    topic: z.string().optional().describe('Optional filter: amounts, gems, ngr, sports, user_keys, bo_stats, withdraw, ledger, run_query'),
  },
  getDataDictionary
);

// --- Tool: check_withdraw_eligibility ---
registerReadOnlyTool(
  'check_withdraw_eligibility',
  'Explain a user\'s withdrawal limits: daily limit = max(2x deposits last 24h, rank maxDailyWithdraw), current usage (successful withdrawals + pending requests), remaining amount, and every gating rule (KYC above $500, $5 minimum, wager requirement, account flags). Answers "why can\'t this user withdraw?".',
  {
    userId: z.string().describe('User identifier: ObjectId, publicId, username, email, wallet address, or Discord ID'),
  },
  checkWithdrawEligibility
);

// --- Tool: get_platform_stats ---
registerReadOnlyTool(
  'get_platform_stats',
  'Monthly platform KPIs computed exactly like the back office: deposits, withdrawals, net cash flow (cash NGR), unique depositors, first-time depositors, registrations. Applies the BO exclusions (bots/statsexclusions, excluded blockchain, MRC migration, gem swaps) — use this instead of ad-hoc aggregates for any financial question. Amounts in USD.',
  {
    startMonth: z.string().optional().describe('First month, YYYY-MM (default: 11 months before endMonth)'),
    endMonth: z.string().optional().describe('Last month, YYYY-MM (default: current month)'),
  },
  getPlatformStats
);

// --- Tool: list_collections ---
registerReadOnlyTool(
  'list_collections',
  'List all available MongoDB collections with document counts. Useful for discovering what data is available.',
  {},
  async () => {
    const db = (await getConnection()).db!;
    const collections = await db.listCollections().toArray();
    return Promise.all(
      collections
        .filter((c) => c.name !== 'adminusers')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (c) => {
          const count = await db.collection(c.name).estimatedDocumentCount();
          return { name: c.name, count };
        })
    );
  }
);

// --- Start server ---
async function main() {
  // Warm up the MongoDB connection so the first tool call doesn't pay the
  // 1-3s Atlas connection setup. Errors are swallowed: the next tool call
  // retries via getConnection().
  void getConnection().catch(() => {});

  const useHttp = process.env.MCP_PORT || process.argv.includes('--http');

  if (useHttp) {
    // HTTP mode — for deployment or `npm run dev:http`
    const app = express();
    app.use(express.json());
    const port = parseInt(process.env.MCP_PORT || '3456', 10);
    const host = process.env.MCP_HOST || '127.0.0.1';

    // Optional bearer-token auth — required if the server is exposed beyond localhost
    const authToken = process.env.MCP_AUTH_TOKEN;
    if (authToken) {
      app.use('/mcp', (req, res, next) => {
        if (req.headers.authorization !== `Bearer ${authToken}`) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        next();
      });
    }

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

    app.listen(port, host, () => {
      console.log(`[moonroll-mcp] HTTP server on http://${host}:${port}/mcp (auth: ${authToken ? 'bearer token' : 'none'})`);
      console.log(`[moonroll-mcp] target=${targetEnv} name=${serverName}, ${toolCount} tools registered`);
    });
  } else {
    // stdio mode — for local Claude Code via .mcp.json
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[moonroll-mcp] stdio server started (target=${targetEnv} name=${serverName}), ${toolCount} tools registered`);
  }
}

main().catch((err) => {
  console.error('[moonroll-mcp] Fatal error:', err);
  process.exit(1);
});

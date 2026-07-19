# moonroll-mcp-server

MCP server exposing **read-only** access to the Moonroll MongoDB database and CloudWatch logs, for support/fraud/finance investigations from Claude Code or any MCP client.

All 17 tools are annotated `readOnlyHint`. Every response is passed through a recursive redaction layer (`src/redact.ts`) that strips sensitive fields (`password`, `pkSol`, `intercomHash`, string `nonce`) wherever they appear.

## Setup

```bash
npm install
cp .env.example .env       # prod credentials
cp .env.example .env.dev   # dev credentials (optional)
```

Which env file is loaded is selected by `MOONROLL_ENV` (unset/`prod` → `.env`, registers as `moonroll-debug`; `dev` → `.env.dev`, registers as `moonroll-debug-dev`).

Local registration for Claude Code is in `.mcp.json` (stdio via `npx tsx src/index.ts`).

## Run

```bash
npm run dev        # stdio mode (what .mcp.json uses)
npm run dev:http   # HTTP mode on http://127.0.0.1:3456/mcp
npm run build && npm start
```

HTTP mode binds `127.0.0.1` by default (`MCP_HOST` to override). If `MCP_AUTH_TOKEN` is set, requests must send `Authorization: Bearer <token>` — required before exposing the server beyond localhost.

## Tools

**Start here**
- `get_data_dictionary` — field semantics and pitfalls (gems booked 1:1 USD, betState codes, per-collection user keys, BO stats rules, EJSON tips). Consult before writing custom queries.
- `find_user` — resolve any identifier (ObjectId, publicId, name, email, wallet, Discord) to profile + balance. All `userId` parameters below accept the same identifiers.
- `list_collections` — collections with document counts.

**User investigation**
- `get_user_bets` (compact by default, `full: true` for game state + seeds), `get_user_ledger` (balanceAfter tracing), `get_user_daily_stats`, `get_user_sessions` (login/IP history), `get_user_bonuses`, `get_user_referrals`
- `get_user_tradings`, `get_user_withdrawals` (pending + failed), `check_withdraw_eligibility` (daily limit = max(2× deposits 24h, rank cap) + KYC/wager/flag checks)
- `get_user_sports_bets`, `get_user_sports_activity` (BetConstruct)

**Platform**
- `get_platform_stats` — monthly deposits/withdrawals/net cash/depositors/FTD/registrations, computed with the exact BO exclusion rules.
- `run_query` — raw read-only Mongo queries (find/findOne/countDocuments/aggregate). Filters accept Extended JSON: `{"$oid":"..."}`, `{"$date":"..."}`. `adminusers` is blocked, including via `$lookup`/`$unionWith`; `$where`/`$function`/`$out`/`$merge` are rejected.
- `search_logs` — CloudWatch by user or requestId, level filtering server-side.

## Scripts

- `scripts/pull-deck-reconciliation.ts` — recomputes the dataroom-deck figures from the live DB (BO-style) and prints them side-by-side vs the deck. `get_platform_stats` is the tool version of the same aggregates.

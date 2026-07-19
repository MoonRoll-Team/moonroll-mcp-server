/**
 * READ-ONLY reconciliation: recompute the dataroom-deck figures from the live
 * Moonroll DB, the same way the BO does, and print side-by-side vs the deck.
 *
 * Mirrors stats.routes.ts / verify-unit-economics.ts:
 *   - amount = gemPrice (array[0] or scalar), in USD cents (raw; no old-MRC normalization)
 *   - exclusions: status!=failed, blockchain!=EXCLUDED, not MRC migration, action!=SWAP_GEMS_TO_MRC,
 *     requestedUser not in (statsexclusions.userId ∪ botconfigs.userId)
 *   - deposit = action ^DEPOSIT_ or 'Deposit'; withdraw = ^WITHDRAW_ or 'Withdraw'
 * Read-only: only aggregate/distinct/countDocuments. No writes.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const EXCLUDED_BLOCKCHAIN = '5HsZR8eG7QpQcN8Mnp8oFdENRkJMP9ZkcKhPSCKTJSWh';
const usd = (cents: number) => (cents / 100);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

// ---- deck (extracted from the dataroom) ----------------------------------
const months = ['2024-07','2024-08','2024-09','2024-10','2024-11','2024-12','2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12'];
const deck: Record<string, { dep: number; wd: number; ngr: number; totDep: number; ftd: number; reg: number }> = {
  '2024-07': { dep:555891, wd:418339, ngr:137552, totDep:713, ftd:422, reg:957 },
  '2024-08': { dep:371714, wd:304018, ngr:67696, totDep:473, ftd:268, reg:1139 },
  '2024-09': { dep:335126, wd:247671, ngr:87455, totDep:1037, ftd:901, reg:4283 },
  '2024-10': { dep:355843, wd:288538, ngr:67305, totDep:738, ftd:131, reg:179 },
  '2024-11': { dep:449824, wd:304566, ngr:145258, totDep:544, ftd:201, reg:285 },
  '2024-12': { dep:567023, wd:480396, ngr:86627, totDep:606, ftd:257, reg:340 },
  '2025-01': { dep:628911, wd:647563, ngr:-18652, totDep:611, ftd:225, reg:309 },
  '2025-02': { dep:618358, wd:652224, ngr:-33865, totDep:557, ftd:220, reg:508 },
  '2025-03': { dep:520834, wd:445733, ngr:75102, totDep:451, ftd:116, reg:451 },
  '2025-04': { dep:555904, wd:457701, ngr:98203, totDep:383, ftd:202, reg:954 },
  '2025-05': { dep:595185, wd:533388, ngr:61797, totDep:483, ftd:181, reg:902 },
  '2025-06': { dep:611682, wd:530532, ngr:81150, totDep:469, ftd:171, reg:744 },
  '2025-07': { dep:657920, wd:568866, ngr:89054, totDep:377, ftd:132, reg:509 },
  '2025-08': { dep:504603, wd:407179, ngr:97424, totDep:382, ftd:113, reg:363 },
  '2025-09': { dep:846095, wd:769635, ngr:76460, totDep:433, ftd:152, reg:433 },
  '2025-10': { dep:435870, wd:352278, ngr:83592, totDep:377, ftd:196, reg:529 },
  '2025-11': { dep:313048, wd:259211, ngr:53837, totDep:367, ftd:67, reg:303 },
  '2025-12': { dep:234806, wd:155737, ngr:79069, totDep:302, ftd:64, reg:460 },
};

const rawAmount = { $cond: [ { $isArray: '$gemPrice' }, { $ifNull: [ { $arrayElemAt: ['$gemPrice', 0] }, 0 ] }, { $ifNull: ['$gemPrice', 0] } ] };
const actionGroup = { $cond: [ { $or: [ { $regexMatch: { input: '$action', regex: /^WITHDRAW_/ } }, { $eq: ['$action', 'Withdraw'] } ] }, 'withdraw', { $cond: [ { $or: [ { $regexMatch: { input: '$action', regex: /^DEPOSIT_/ } }, { $eq: ['$action', 'Deposit'] } ] }, 'deposit', 'other' ] } ] };

async function main() {
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL missing');
  console.error('Connecting (read-only)...');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db!;

  // exclusion ids = statsexclusions.userId ∪ botconfigs.userId
  const [manualRaw, botRaw] = await Promise.all([
    db.collection('statsexclusions').distinct('userId').catch(() => []),
    db.collection('botconfigs').distinct('userId').catch(() => []),
  ]);
  const toOid = (v: any) => { try { return v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(v); } catch { return null; } };
  const exMap = new Map<string, mongoose.Types.ObjectId>();
  [...manualRaw, ...botRaw].forEach((v: any) => { const o = toOid(v); if (o) exMap.set(o.toString(), o); });
  const excludedIds = Array.from(exMap.values());
  console.error(`Excluded users: ${excludedIds.length} (manual ${manualRaw.length} + bots ${botRaw.length})`);

  const base = (start: Date, end: Date) => ({
    createdAt: { $gte: start, $lt: end },
    status: { $ne: 'failed' },
    requestedUser: { $nin: excludedIds },
    blockchain: { $ne: EXCLUDED_BLOCKCHAIN },
    $nor: [{ failedReason: 'Generated_By_Migration', blockchain: 'MRC' }],
    action: { $ne: 'SWAP_GEMS_TO_MRC' },
  });

  const winStart = new Date(Date.UTC(2024, 6, 1));
  const winEnd = new Date(Date.UTC(2026, 0, 1));

  // monthly flows
  const flows = await db.collection('tradings').aggregate([
    { $match: base(winStart, winEnd) },
    { $addFields: { ag: actionGroup, amt: rawAmount } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        dep: { $sum: { $cond: [{ $eq: ['$ag', 'deposit'] }, '$amt', 0] } },
        wd: { $sum: { $cond: [{ $eq: ['$ag', 'withdraw'] }, '$amt', 0] } } } },
    { $sort: { _id: 1 } }, { $limit: 100 },
  ], { allowDiskUse: true }).toArray();

  // total depositors / month
  const totDep = await db.collection('tradings').aggregate([
    { $match: base(winStart, winEnd) },
    { $addFields: { ag: actionGroup } }, { $match: { ag: 'deposit' } },
    { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, u: '$requestedUser' } } },
    { $group: { _id: '$_id.m', n: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $limit: 100 },
  ], { allowDiskUse: true }).toArray();

  // FTD: first-ever deposit per user (all history up to winEnd), bucket by month
  const ftd = await db.collection('tradings').aggregate([
    { $match: { ...base(new Date(Date.UTC(2020,0,1)), winEnd) } },
    { $addFields: { ag: actionGroup } }, { $match: { ag: 'deposit' } },
    { $group: { _id: '$requestedUser', first: { $min: '$createdAt' } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$first' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } }, { $limit: 200 },
  ], { allowDiskUse: true }).toArray();

  // registrations / month (users.createdAt) — total (no exclusion) to match deck "New sign-ups"
  const regs = await db.collection('users').aggregate([
    { $match: { createdAt: { $gte: winStart, $lt: winEnd } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } }, { $limit: 100 },
  ], { allowDiskUse: true }).toArray();

  const mFlow = new Map(flows.map((r: any) => [r._id, r]));
  const mTot = new Map(totDep.map((r: any) => [r._id, r.n]));
  const mFtd = new Map(ftd.map((r: any) => [r._id, r.n]));
  const mReg = new Map(regs.map((r: any) => [r._id, r.n]));

  const pad = (s: any, n: number) => String(s).padStart(n);
  console.log('\n================= MONTHLY: computed (BO-style) vs deck =================');
  console.log('month   | NGR(netflow) comp |   deck    |  Δ%   || Deposit comp | deck | Δ% || totDep c/deck | FTD c/deck | Reg c/deck');
  for (const m of months) {
    const f: any = mFlow.get(m) || { dep: 0, wd: 0 };
    const net = (f.dep - f.wd) / 100; const dep = f.dep / 100;
    const d = deck[m];
    const dpct = (a: number, b: number) => b === 0 ? '—' : (((a - b) / Math.abs(b)) * 100).toFixed(0) + '%';
    console.log(
      `${m} | ${pad(fmt(net),12)} | ${pad(fmt(d.ngr),9)} | ${pad(dpct(net, d.ngr),5)} || ${pad(fmt(dep),11)} | ${pad(fmt(d.dep),9)} ${pad(dpct(dep,d.dep),5)} || ${pad((mTot.get(m)||0),5)}/${pad(d.totDep,5)} | ${pad((mFtd.get(m)||0),4)}/${pad(d.ftd,4)} | ${pad((mReg.get(m)||0),5)}/${pad(d.reg,5)}`
    );
  }

  // ---- ARPU/LTV windows ----
  const windows = [
    { label: 'Year 2024', s: Date.UTC(2024,0,1), e: Date.UTC(2024,11,31,23,59,59,999), deck: { dep:4295505, ngr:1120548, players:6074, per:184 } },
    { label: '2025-01..2025-11-11', s: Date.UTC(2025,0,1), e: Date.UTC(2025,10,11,23,59,59,999), deck: { dep:6127430, ngr:638834, players:1695, per:377 } },
    { label: 'LTV 2022-06..2024-12-31', s: Date.UTC(2022,5,1), e: Date.UTC(2024,11,31,23,59,59,999), deck: { ngr:1745275, players:13839, per:126.11 } },
    { label: 'LTV 2022-06..2025-11-11', s: Date.UTC(2022,5,1), e: Date.UTC(2025,10,11,23,59,59,999), deck: { ngr:2395006, players:15063, per:158.99 } },
  ];
  console.log('\n================= ARPU/LTV windows: computed vs deck =================');
  for (const w of windows) {
    const start = new Date(w.s), end = new Date(w.e);
    const [agg] = await db.collection('tradings').aggregate([
      { $match: { ...base(start, end), createdAt: { $gte: start, $lte: end } } },
      { $addFields: { ag: actionGroup, amt: rawAmount } },
      { $group: { _id: null, dep: { $sum: { $cond: [{ $eq: ['$ag','deposit'] }, '$amt', 0] } }, wd: { $sum: { $cond: [{ $eq: ['$ag','withdraw'] }, '$amt', 0] } } } },
    ], { allowDiskUse: true }).toArray() as any[];
    const [du] = await db.collection('tradings').aggregate([
      { $match: { ...base(start, end), createdAt: { $gte: start, $lte: end } } },
      { $addFields: { ag: actionGroup } }, { $match: { ag: 'deposit' } },
      { $group: { _id: null, u: { $addToSet: '$requestedUser' } } }, { $project: { n: { $size: '$u' } } },
    ], { allowDiskUse: true }).toArray() as any[];
    const net = ((agg?.dep || 0) - (agg?.wd || 0)); const players = du?.n || 0;
    const per = players ? net / players / 100 : 0;
    console.log(`\n=== ${w.label} ===`);
    if ((w.deck as any).dep != null) console.log(`  Deposits   comp $${fmt(usd(agg?.dep||0))}  | deck $${fmt((w.deck as any).dep)}`);
    console.log(`  NGR(net)   comp $${fmt(usd(net))}  | deck $${fmt(w.deck.ngr)}`);
    console.log(`  Depositors comp ${fmt(players)}  | deck ${fmt(w.deck.players)}`);
    console.log(`  per player comp $${per.toFixed(2)}  | deck $${w.deck.per}`);
  }

  await mongoose.disconnect();
  console.error('done');
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * The Overmind service: a round every minute, on the minute, and a small read-only API for the site.
 *   GET /health                 liveness, the current disk, the model and where media is stored
 *   GET /api/state              the disk being written, how far along, time to the next save
 *   GET /api/disks?from=&to=    disks in a range (at most 200)
 *   GET /api/disks/:n           one disk with its slots
 *   GET /api/events?v=          server-sent events: slot, media, seal, disk, presence (v: the visitor's id, for the count)
 *   /api/lp/…                   the launchpad (src/lp/routes.ts): launch a coin, its disk on the wall, holder snapshots
 *   POST /api/nominate          {url, v}: a visitor's SAVE at the terminal (curated sources only); GET /api/nominations?v= their own
 *   POST /api/activity          {kind: open|share, disk, v} or {kind: docs, v}: what a visitor did, told to the room (no free text)
 *   GET /api/disks/:n/image     a sealed disk as a real 1.44 MB FAT12 floppy image (mounts in DOSBox or an emulator)
 *   GET /d/:n, /c/:mint (+ /card.png)  share links: a preview card for X/Telegram, then on into the room (CloudFront routes them here)
 *   GET /api/books              every wallet the Overmind uses: balance, in, out, recent moves, and whether it adds up
 *   GET /api/coin               $OMD's numbers for the board (DexScreener, cached a minute; none until OMD_MINT is set)
 *   GET /media/:key             the instrument's stills and loops (CORS, immutable)
 * ROUND_EVERY_MS overrides the minute (local testing only).
 */
import { describe } from './claude.js';
import { MAINNET_RPC, rpcKind } from './rpc.js';
import { CHAIN_RPC } from './chain.js';
import { BOOKS_RPC } from './books.js';
import { RPC_URL as LP_RPC, DAS_URL } from './lp/solana.js';
import { createServer, type ServerResponse } from 'node:http';
import { countCheck, currentDisk, disks, migrate, pool, slots, type DiskRow, type SlotRow } from './db.js';
import { anchorPending, ensureDisk, events, round, SLOTS } from './archivist.js';
import { balanceOf, explorer, signer, walletInfo } from './chain.js';
import { coin } from './coin.js';
import { recordText } from './seal.js';
import { floppyImage } from './floppy-image.js';
import { coinCard, diskCard, sharePage, shareUrls } from './share.js';
import { coin as lpCoin, image as lpImage } from './lp/coins.js';
import { refreshWatch, watch, watchEvents } from './watch.js';
import { get as getMedia, mediaOptions, storage } from './media.js';
import { MODEL } from './mind.js';
import { talk } from './talk.js';
import { arrive, here, presenceEvents } from './presence.js';
import { activityEvents, lately, tagOf, tell, visitorOf } from './activity.js';
import { migrateNominations, mine, nominate } from './nominate.js';
import { lpJobs, lpRoute } from './lp/routes.js';
import { migrateLaunchpad } from './lp/coins.js';
import { count, migrateStats, stats, statsPage } from './stats.js';
import { scheduleBackups } from './backup.js';
import { startPosting } from './post.js';
import { books, migrateBooks } from './books.js';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8080);
const EVERY = Number(process.env.ROUND_EVERY_MS ?? 60_000);
/**
 * The backlog: until the lineage has BACKLOG_DISKS disks, the Overmind writes fast (one save every BACKLOG_EVERY_MS)
 * so the tower is already tall when people arrive; then it writes on the minute. Every save keeps its true time.
 */
const BACKLOG_DISKS = Number(process.env.BACKLOG_DISKS ?? 0);
const BACKLOG_EVERY = Number(process.env.BACKLOG_EVERY_MS ?? 6_000);
let nextAt = 0;
/** The cadence right now (ms between saves): the page counts down with it. */
let every = EVERY;

const diskJson = (d: DiskRow) => ({
  n: d.n, seed: Number(d.seed), fascination: d.fascination, written: d.written, sealed: !!d.sealed_at, fingerprint: d.fingerprint, checks: d.checks ?? 0,
  startedAt: +new Date(d.started_at), sealedAt: d.sealed_at ? +new Date(d.sealed_at) : null,
  chain: d.seal_tx ? { cluster: d.seal_cluster, tx: d.seal_tx, url: explorer(d.seal_tx) } : d.sealed_at ? { pending: true } : null,
});
const slotJson = (s: SlotRow) => ({
  disk: s.disk, index: s.k, time: +new Date(s.time), item: s.item ?? undefined, note: s.note, file: s.file, model: s.model,
  dice: { source: s.dice.source, round: s.dice.round, quantum: s.dice.quantum },
  qday: s.qday_shift ?? undefined,
});

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

/** Simple sliding-window limits (per address, and overall where a route spends something shared). */
const windows = new Map<string, number[]>();
function within(key: string, n: number, ms: number): boolean {
  const now = Date.now(), hits = (windows.get(key) ?? []).filter((t) => now - t < ms);
  if (hits.length >= n) { windows.set(key, hits); return false; }
  hits.push(now); windows.set(key, hits);
  if (windows.size > 50_000) for (const [k, v] of windows) if (!v.some((t) => now - t < 3_600_000)) windows.delete(k);
  return true;
}
const streams = new Map<string, number>();
let totalStreams = 0;

/** A visitor's CHECK counts once per disk per ten minutes, however many times they press it. */
const checked = new Map<string, number>();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  // Railway's edge sets X-Real-IP to the connecting client (checked in production: X-Forwarded-For ends with the edge's own
  // address, so its last entry would make everyone one visitor)
  const ip = String(req.headers['x-real-ip'] ?? String(req.headers['x-forwarded-for'] ?? '').split(',')[0] ?? req.socket.remoteAddress ?? '').trim();
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); return res.end(); }
    // the launchpad: its own routes (reads open; launching only while LP_LIVE is on)
    if (path.startsWith('/api/lp/')) {
      const r = await lpRoute(req, path.slice('/api/lp/'.length), ip);
      const body = Buffer.isBuffer(r.body) ? r.body : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      res.writeHead(r.status, { 'content-type': r.type ?? 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': r.cache ?? 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(body);
    }
    // the terminal: the only thing a visitor can send
    if (req.method === 'POST' && path === '/api/chat') {
      if (!within('chat:all', 120, 60_000)) return send(res, 429, { error: 'busy' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8_000) return send(res, 413, { error: 'too long' }); }
      let body: { messages?: { role: 'user' | 'assistant'; content: string }[]; v?: string; disk?: number } = {};
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
      const r = await talk(ip, Array.isArray(body.messages) ? body.messages : [], typeof body.disk === 'number' ? body.disk : undefined);
      count('chat');
      if (r.status !== 'limited') tell({ kind: 'talk', by: tagOf(visitorOf(body.v, ip)) }, ip);
      return send(res, 200, r);
    }
    // a visitor's nomination: a link from a curated source, read from the source itself
    if (req.method === 'POST' && path === '/api/nominate') {
      if (!within(`nom:${ip}`, 10, 60_000) || !within('nom:all', 60, 60_000)) return send(res, 200, { ok: false, reply: 'one at a time. try again in a minute.' });
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 2_000) return send(res, 413, { error: 'too long' }); }
      let body: { url?: string; v?: string } = {};
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
      if (typeof body.url !== 'string' || !body.url.trim()) return send(res, 200, { ok: false, reply: 'give me a link: SAVE https://…' });
      const nr = await nominate(body.url.slice(0, 500), visitorOf(body.v, ip), ip);
      if (nr.ok) count('nominate');
      return send(res, 200, nr);
    }
    // what a visitor did (opened or shared a disk): a kind and a number, nothing they typed
    if (req.method === 'POST' && path === '/api/activity') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 500) return send(res, 413, { error: 'too long' }); }
      let body: { kind?: string; disk?: number; v?: string } = {};
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
      const by = tagOf(visitorOf(body.v, ip));
      if (body.kind === 'docs') tell({ kind: 'docs', by }, ip);
      else {
        const d = await currentDisk();
        if ((body.kind !== 'open' && body.kind !== 'share') || !Number.isInteger(body.disk) || body.disk! < 0 || !d || body.disk! > d.n) return send(res, 400, { error: 'no' });
        tell({ kind: body.kind, disk: body.disk, by }, ip);
      }
      res.writeHead(204, { 'access-control-allow-origin': '*' }); return res.end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'read only' }); // HEAD: as GET, without the body (link checkers)
    if (path === '/api/balance') {
      const address = url.searchParams.get('address') ?? '';
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return send(res, 400, { error: 'not an address' });
      if (!within(`bal:${ip}`, 12, 60_000) || !within('bal:all', 240, 60_000)) return send(res, 429, { error: 'slow down' });
      const sol = await balanceOf(address);
      return sol === undefined ? send(res, 502, { error: 'no answer' }) : send(res, 200, { address, sol });
    }
    if (path === '/api/coin') return send(res, 200, await coin());
    if (path === '/api/books') return send(res, 200, await books());
    if (path === '/stats' || path === '/api/stats') { // the owner's numbers, behind the key the server made for itself
      if (url.searchParams.get('key') !== statsKey) return send(res, 404, { error: 'not found' });
      const s = await stats();
      if (path === '/api/stats') return send(res, 200, s);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(statsPage(s));
    }
    if (path === '/api/nominations') return send(res, 200, await mine(visitorOf(url.searchParams.get('v'), ip)));
    if (path === '/health') {
      const d = await currentDisk();
      return send(res, 200, { ok: true, disk: d?.n ?? null, written: d?.written ?? 0, model: describe(MODEL), storage, wallet: await walletInfo(),
        rpc: { seals: rpcKind(CHAIN_RPC), launchpad: rpcKind(LP_RPC), snapshots: rpcKind(DAS_URL), books: rpcKind(BOOKS_RPC), watch: rpcKind(MAINNET_RPC) } });
    }
    if (path === '/api/state') {
      const d = await currentDisk();
      return send(res, 200, { now: Date.now(), slots: SLOTS, disk: d ? diskJson(d) : null, msToNext: Math.max(0, nextAt - Date.now()), every, watch, here: here(), launchAt: Number.isNaN(LAUNCH_AT) ? null : LAUNCH_AT });
    }
    if (path === '/api/disks') {
      const from = Math.max(0, Number(url.searchParams.get('from') ?? 0) | 0);
      const to = Math.min(from + 199, Number(url.searchParams.get('to') ?? from + 199) | 0);
      return send(res, 200, (await disks(from, to)).map(diskJson));
    }
    // share links: a page that previews as the disk (or coin), and sends people on into the room
    const share = path.match(/^\/d\/(\d{1,6})(\/card\.png)?$/);
    if (share) {
      const n = Number(share[1]) - 1;
      const [d] = n >= 0 ? await disks(n, n) : [];
      if (!d) return send(res, 404, { error: 'no such disk' });
      const site = shareUrls.site, num = String(n + 1);
      if (share[2]) {
        const png = await diskCard(d, await slots(n));
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': d.sealed_at ? 'public, max-age=86400' : 'public, max-age=300', 'access-control-allow-origin': '*' });
        return res.end(png);
      }
      const last = (await slots(n)).reverse().find((s) => s.item);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(sharePage({ title: `Disk ${num.padStart(4, '0')} · Overmind`, description: last ? `${last.item?.title}: ${last.note}` : 'The record that survives Q-Day.',
        image: `${site}/d/${num}/card.png`, to: `${site}/#disk-${num}` }));
    }
    const coinShare = path.match(/^\/c\/([1-9A-HJ-NP-Za-km-z]{32,44})(\/card\.png)?$/);
    if (coinShare) {
      const c = await lpCoin(coinShare[1]);
      if (!c || c.status !== 'live') return send(res, 404, { error: 'no such coin' });
      const site = shareUrls.site;
      if (coinShare[2]) {
        const id = c.image?.match(/\/api\/lp\/media\/([a-f0-9]{64})$/)?.[1];
        const pic = id ? (await lpImage(id))?.bytes : undefined;
        const png = await coinCard(c, pic);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' });
        return res.end(png);
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(sharePage({ title: `$${c.ticker} on the Overmind's wall`, description: c.note ?? `${c.name}: its holders are written down and sealed, so ownership can be proven after Q-Day.`,
        image: `${site}/c/${c.mint}/card.png`, to: `${site}/#coin-${c.mint}` }));
    }
    const imgPath = path.match(/^\/api\/disks\/(\d+)\/image$/);
    if (imgPath) {
      const n = Number(imgPath[1]);
      const [d] = await disks(n, n);
      if (!d?.sealed_at) return send(res, 404, { error: 'not sealed yet' });
      const body = floppyImage(d, await slots(n));
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="overmind-disk-${String(n + 1).padStart(4, '0')}.img"`,
        'content-length': String(body.length), 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' });
      return res.end(body);
    }
    const rec = path.match(/^\/api\/disks\/(\d+)\/record$/);
    if (rec) {
      // the exact text whose SHA-256 is the disk's fingerprint (and is on chain once sealed)
      const n = Number(rec[1]);
      const [d] = await disks(n, n);
      if (!d?.sealed_at) return send(res, 404, { error: 'not sealed yet' });
      const text = recordText(await slots(n));
      // a visitor checking: count it once, and tell the room (whether what was served still hashes to the seal)
      const by = visitorOf(url.searchParams.get('v'), ip), key = `${by}:${n}`, now = Date.now();
      if (now - (checked.get(key) ?? 0) > 10 * 60_000) {
        checked.set(key, now);
        if (checked.size > 50_000) for (const [k, t] of checked) if (now - t > 10 * 60_000) checked.delete(k);
        const checks = await countCheck(n);
        const match = createHash('sha256').update(text).digest('hex') === d.fingerprint;
        tell({ kind: 'check', disk: n, match, checks, by: tagOf(by) }, ip);
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-fingerprint': d.fingerprint ?? '' });
      return res.end(text);
    }
    const one = path.match(/^\/api\/disks\/(\d+)$/);
    if (one) {
      const n = Number(one[1]);
      const [d] = await disks(n, n);
      if (!d) return send(res, 404, { error: 'no such disk' });
      // a sealed disk never changes: let it be cached
      return send(res, 200, { disk: diskJson(d), slots: (await slots(n)).map(slotJson) }, d.sealed_at ? { 'cache-control': 'public, max-age=3600' } : {});
    }
    if (path === '/api/events') {
      if ((streams.get(ip) ?? 0) >= 12 || totalStreams >= 4000) return send(res, 429, { error: 'too many open streams' });
      streams.set(ip, (streams.get(ip) ?? 0) + 1); totalStreams++;
      req.on('close', () => { const n = (streams.get(ip) ?? 1) - 1; if (n > 0) streams.set(ip, n); else streams.delete(ip); totalStreams--; });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      res.write(`retry: 5000\n\n`);
      const emit = (type: string) => (data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      const handlers = {
        slot: (s: SlotRow) => emit('slot')({ ...slotJson(s), every }),
        disk: (d: DiskRow) => emit('disk')(diskJson(d)),
        seal: emit('seal'),
        chain: emit('chain'),
        media: emit('media'),
      };
      for (const [k, h] of Object.entries(handlers)) events.on(k, h);
      const onWatch = emit('watch');
      watchEvents.on('watch', onWatch);
      const onPresence = emit('presence');
      presenceEvents.on('presence', onPresence);
      const leave = arrive(url.searchParams.get('v'));
      onPresence({ here: here() });
      const onActivity = emit('activity');
      activityEvents.on('activity', onActivity);
      emit('hello')({ you: tagOf(visitorOf(url.searchParams.get('v'), ip)) });
      for (const a of lately()) onActivity(a);
      const beat = setInterval(() => res.write(': beat\n\n'), 25_000);
      req.on('close', () => { clearInterval(beat); leave(); activityEvents.off('activity', onActivity); presenceEvents.off('presence', onPresence); watchEvents.off('watch', onWatch); for (const [k, h] of Object.entries(handlers)) events.off(k, h); });
      return;
    }
    const media = path.match(/^\/media\/([\w.-]+)$/);
    if (media) {
      const file = await getMedia(media[1]);
      if (!file) return send(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': file.type, 'content-length': String(file.body.length), 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(file.body);
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(path, e);
    if (!res.headersSent) send(res, 500, { error: 'internal' });
  }
});

/**
 * Saves land on the minute: each round starts LEAD early (dice, sources, the mind take a few seconds) and writes its
 * slot at the minute itself (plus a moment, so the clock has rolled over everywhere).
 */
const LEAD = 20_000;
/** LAUNCH_AT (ISO time): asleep until then; the first save lands on the launch minute. */
const LAUNCH_AT = process.env.LAUNCH_AT ? Date.parse(process.env.LAUNCH_AT) : NaN;
async function schedule() {
  const d = await currentDisk().catch(() => undefined);
  if (d && d.n < BACKLOG_DISKS) {
    // the backlog: back to back, a save at most every BACKLOG_EVERY (a round that takes longer just writes when done)
    every = BACKLOG_EVERY;
    mediaOptions.clips = false; // stills only: clips would fall hours behind at this pace
    const at = Date.now() + BACKLOG_EVERY;
    nextAt = at;
    try { await round(new Date(), at); } catch (e) { console.error('round failed', e); }
    setTimeout(() => void schedule(), Math.max(0, at - Date.now()));
    return;
  }
  every = EVERY;
  mediaOptions.clips = true;
  const minute = EVERY === 60_000;
  const from = Number.isNaN(LAUNCH_AT) ? Date.now() : Math.max(Date.now(), LAUNCH_AT - 400);
  const at = minute ? from - (from % 60_000) + 60_400 : Date.now() + EVERY;
  const start = minute && at - LEAD > Date.now() + 1000 ? at - LEAD : at;
  nextAt = at;
  setTimeout(async () => {
    setTimeout(() => void schedule(), Math.max(0, at - Date.now()) + 50); // the next round is planned once this minute has turned
    try { await round(new Date(), at); } catch (e) { console.error('round failed', e); }
  }, start - Date.now());
}

await migrate();
await migrateNominations();
await migrateLaunchpad();
const statsKey = await migrateStats();
await migrateBooks();
scheduleBackups();
startPosting();
// A stray rejection from a background chain call (web3.js's confirmation polling can throw a 429 nobody awaits) is
// logged, not fatal: every chain job here is retried on its own schedule, and the archive must keep writing.
process.on('unhandledRejection', (e) => console.warn('unhandled rejection (kept running):', String((e as Error)?.message ?? e).slice(0, 200)));
setInterval(() => { lpJobs().catch((e) => console.warn('launchpad jobs failed', e)); }, 5 * 60_000);
await ensureDisk();
const w = await signer();
console.log(`sealing on ${process.env.SOLANA_CLUSTER ?? 'devnet'} from ${w.publicKey.toBase58()}`);
setInterval(() => { anchorPending().catch((e) => console.warn('anchor retry failed', e)); }, 5 * 60_000);
await refreshWatch();
setInterval(() => { refreshWatch().catch((e) => console.warn('watch failed', e)); }, 5 * 60_000);
void anchorPending().catch(() => {});
server.listen(PORT, () => {
  console.log(`overmind on :${PORT} · model ${describe(MODEL)} · media on ${storage}${BACKLOG_DISKS ? ` · backlog to ${BACKLOG_DISKS} disks, a save every ${BACKLOG_EVERY} ms` : ''}`);
  void schedule();
});
const stop = async () => { server.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

/**
 * The Overmind service: a round every minute, on the minute, and a small read-only API for the site.
 *   GET /health                 liveness, the current disk, the model and where media is stored
 *   GET /api/state              the disk being written, how far along, time to the next save
 *   GET /api/disks?from=&to=    disks in a range (at most 200)
 *   GET /api/disks/:n           one disk with its slots
 *   GET /api/events             server-sent events: slot, media, seal, disk
 *   GET /api/coin               $OMD's numbers for the board (DexScreener, cached a minute; none until OMD_MINT is set)
 *   GET /media/:key             the instrument's stills and loops (CORS, immutable)
 * ROUND_EVERY_MS overrides the minute (local testing only).
 */
import { createServer, type ServerResponse } from 'node:http';
import { currentDisk, disks, migrate, pool, slots, type DiskRow, type SlotRow } from './db.js';
import { anchorPending, ensureDisk, events, round, SLOTS } from './archivist.js';
import { balanceOf, explorer, signer, walletInfo } from './chain.js';
import { coin } from './coin.js';
import { recordText } from './seal.js';
import { refreshWatch, watch, watchEvents } from './watch.js';
import { get as getMedia, mediaOptions, storage } from './media.js';
import { MODEL } from './mind.js';
import { talk } from './talk.js';

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
  n: d.n, seed: Number(d.seed), fascination: d.fascination, written: d.written, sealed: !!d.sealed_at, fingerprint: d.fingerprint,
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); return res.end(); }
    // the terminal: the only thing a visitor can send
    if (req.method === 'POST' && path === '/api/chat') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 8_000) return send(res, 413, { error: 'too long' }); }
      let body: { messages?: { role: 'user' | 'assistant'; content: string }[] } = {};
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad json' }); }
      const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
      return send(res, 200, await talk(ip, Array.isArray(body.messages) ? body.messages : []));
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'read only' });
    if (path === '/api/balance') {
      const address = url.searchParams.get('address') ?? '';
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return send(res, 400, { error: 'not an address' });
      const sol = await balanceOf(address);
      return sol === undefined ? send(res, 502, { error: 'no answer' }) : send(res, 200, { address, sol });
    }
    if (path === '/api/coin') return send(res, 200, await coin());
    if (path === '/health') {
      const d = await currentDisk();
      return send(res, 200, { ok: true, disk: d?.n ?? null, written: d?.written ?? 0, model: process.env.ANTHROPIC_API_KEY ? MODEL : 'template (no ANTHROPIC_API_KEY)', storage, wallet: await walletInfo() });
    }
    if (path === '/api/state') {
      const d = await currentDisk();
      return send(res, 200, { now: Date.now(), slots: SLOTS, disk: d ? diskJson(d) : null, msToNext: Math.max(0, nextAt - Date.now()), every, watch, launchAt: Number.isNaN(LAUNCH_AT) ? null : LAUNCH_AT });
    }
    if (path === '/api/disks') {
      const from = Math.max(0, Number(url.searchParams.get('from') ?? 0) | 0);
      const to = Math.min(from + 199, Number(url.searchParams.get('to') ?? from + 199) | 0);
      return send(res, 200, (await disks(from, to)).map(diskJson));
    }
    const rec = path.match(/^\/api\/disks\/(\d+)\/record$/);
    if (rec) {
      // the exact text whose SHA-256 is the disk's fingerprint (and is on chain once sealed)
      const n = Number(rec[1]);
      const [d] = await disks(n, n);
      if (!d?.sealed_at) return send(res, 404, { error: 'not sealed yet' });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400', 'x-fingerprint': d.fingerprint ?? '' });
      return res.end(recordText(await slots(n)));
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
      const beat = setInterval(() => res.write(': beat\n\n'), 25_000);
      req.on('close', () => { clearInterval(beat); watchEvents.off('watch', onWatch); for (const [k, h] of Object.entries(handlers)) events.off(k, h); });
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
await ensureDisk();
const w = await signer();
console.log(`sealing on ${process.env.SOLANA_CLUSTER ?? 'devnet'} from ${w.publicKey.toBase58()}`);
setInterval(() => { anchorPending().catch((e) => console.warn('anchor retry failed', e)); }, 5 * 60_000);
await refreshWatch();
setInterval(() => { refreshWatch().catch((e) => console.warn('watch failed', e)); }, 5 * 60_000);
void anchorPending().catch(() => {});
server.listen(PORT, () => {
  console.log(`overmind on :${PORT} · model ${process.env.ANTHROPIC_API_KEY ? MODEL : 'template (no ANTHROPIC_API_KEY)'} · media on ${storage}${BACKLOG_DISKS ? ` · backlog to ${BACKLOG_DISKS} disks, a save every ${BACKLOG_EVERY} ms` : ''}`);
  void schedule();
});
const stop = async () => { server.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

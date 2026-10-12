/**
 * The Overmind out loud: when a disk seals it says so on X and Telegram, with a link whose card shows the disk
 * (overmind.im/d/15); on Telegram also when a visitor's nomination makes it through and when a coin launches (launches
 * go to X only with POST_LAUNCHES_TO_X=true: other people's coin names don't go out under its name by default).
 * Off until the keys exist:
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET   an X app with write access (OAuth 1.0a user tokens)
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID                       a bot that is an admin of the channel
 */
import { blocked, privateHit } from './privacy.js';
import { createHmac, randomBytes } from 'node:crypto';
import { pool } from './db.js';
import { events } from './archivist.js';
import { activityEvents, type Activity } from './activity.js';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://overmind.im';
const X = process.env.X_API_KEY && process.env.X_API_SECRET && process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET
  ? { key: process.env.X_API_KEY, secret: process.env.X_API_SECRET, token: process.env.X_ACCESS_TOKEN, tokenSecret: process.env.X_ACCESS_SECRET } : undefined;
const TG = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID } : undefined;
const LAUNCHES_TO_X = process.env.POST_LAUNCHES_TO_X === 'true';

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
/** A post on X (API v2), signed with OAuth 1.0a (the JSON body isn't part of the signature). */
async function tweet(text: string): Promise<void> {
  if (!X) return;
  if (privateHit(text)) { blocked('post to X', privateHit(text)!); return; }
  const url = 'https://api.x.com/2/tweets';
  const o: Record<string, string> = { oauth_consumer_key: X.key, oauth_nonce: randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: X.token, oauth_version: '1.0' };
  const params = Object.keys(o).sort().map((k) => `${enc(k)}=${enc(o[k])}`).join('&');
  o.oauth_signature = createHmac('sha1', `${enc(X.secret)}&${enc(X.tokenSecret)}`).update(`POST&${enc(url)}&${enc(params)}`).digest('base64');
  const auth = 'OAuth ' + Object.keys(o).sort().map((k) => `${enc(k)}="${enc(o[k])}"`).join(', ');
  const r = await fetch(url, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) console.warn(`post: X answered ${r.status} ${(await r.text()).slice(0, 160)}`);
}
/** A Telegram post: the card as a photo with the words as its caption (or just the words). */
async function telegram(text: string, photo?: string): Promise<void> {
  if (!TG) return;
  if (privateHit(text)) { blocked('post to Telegram', privateHit(text)!); return; }
  const method = photo ? 'sendPhoto' : 'sendMessage';
  const body = photo ? { chat_id: TG.chat, photo, caption: text } : { chat_id: TG.chat, text, disable_web_page_preview: false };
  const r = await fetch(`https://api.telegram.org/bot${TG.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) console.warn(`post: Telegram answered ${r.status} ${(await r.text()).slice(0, 160)}`);
}

const fit = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const id = (n: number) => String(n + 1).padStart(4, '0');

/** Listens for seals, kept nominations and launches; says each once, in its voice. */
export function startPosting() {
  if (!X && !TG) return;
  console.log(`posting: ${[X && 'X', TG && 'Telegram'].filter(Boolean).join(' + ')}`);
  events.on('seal', async (s: { n: number; fingerprint: string }) => {
    try {
      const last = (await pool.query(`select item->>'title' as title from slots where disk = $1 and item is not null order by k desc limit 1`, [s.n])).rows[0]?.title as string | undefined;
      const link = `${SITE}/d/${s.n + 1}`;
      const text = `disk ${id(s.n)} is full and sealed. ninety things made it through.\nsha256 ${s.fingerprint.slice(0, 16)}…${last ? `\n\nthe last thing i kept: ${fit(last, 90)}.` : ''}\n\n${link}`;
      await Promise.all([tweet(text), telegram(text, `${link}/card.png`)]);
    } catch (e) { console.warn('post: seal failed', (e as Error).message); }
  });
  activityEvents.on('activity', async (a: Activity & { symbol?: string }) => {
    try {
      if (a.kind === 'picked' && a.disk !== undefined) {
        await telegram(`a visitor asked me to keep something, and it made it through: disk ${id(a.disk)}.\n\n${SITE}/d/${a.disk + 1}`);
      } else if (a.kind === 'launch' && a.symbol) {
        const c = (await pool.query(`select mint, note from lp_coins where ticker = $1 and status = 'live' order by live_at desc limit 1`, [a.symbol])).rows[0] as { mint: string; note: string | null } | undefined;
        if (!c) return;
        const link = `${SITE}/c/${c.mint}`;
        const text = `$${a.symbol} launched through me. its disk is on my wall, and every few hours i write down who holds it.${c.note ? `\n\n${fit(c.note, 150)}` : ''}\n\n${link}`;
        await Promise.all([LAUNCHES_TO_X ? tweet(text) : undefined, telegram(text, `${link}/card.png`)]);
      }
    } catch (e) { console.warn('post: activity failed', (e as Error).message); }
  });
}

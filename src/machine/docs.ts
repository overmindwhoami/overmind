/**
 * The docs: the Overmind's operator's manual, printed on the notebook on the desk (manual.ts). Ten pages, five
 * spreads, set big enough to read from the docs camera on a phone: one idea a page. The last page, the receipts, is
 * printed from the live archive (dates, counts, the sealing wallet), so it never goes stale.
 * Everything is drawn in millimetres on a 220 × 290 mm page.
 */
import { MANUAL } from './manual';

export interface Receipts {
  genesis?: number; // when disk 0001 began (ms)
  firstSeal?: number; // when it sealed
  sealed: number; // disks sealed so far
  wallet?: { address: string; balance: number | null };
  qday?: string; // the Overmind's current guess (YYYY-MM-DD)
  coin?: string; // the $OMD mint address, once it exists
}

type Block =
  | { t: 'title'; n?: string; text: string }
  | { t: 'p'; text: string }
  | { t: 'fact'; big: string; text: string }
  | { t: 'list'; items: string[] }
  | { t: 'voice'; text: string }
  | { t: 'rows'; rows: [string, string][] }
  | { t: 'gap' };

const W = MANUAL.pageW, H = MANUAL.pageD, M = 20;
const FONT = '"PP NeueBit", Menlo, monospace';
const INK = '#1c1a16', SOFT = '#6e685c', RULE = 'rgba(40,36,28,0.22)';
/** Body size and leading (mm); tall screens get the large-print edition (one page fills a phone). */
let BODY = 8, LEAD = 10.4, K = 1;

const date = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-3)}`; // wallets and the mint, shown as a short stub

/** The pages, in reading order. */
export function pages(r: Receipts): Block[][] {
  return [
    // 1: the cover page of the spread
    [
      { t: 'title', text: 'OVERMIND' },
      { t: 'p', text: "operator's manual · rev. 2" },
      { t: 'gap' },
      { t: 'p', text: 'An archive that runs itself, built for the day encryption breaks.' },
      { t: 'gap' },
      { t: 'rows', rows: [['1', 'what this is'], ['2', 'q-day'], ['3', 'sources'], ['4', 'the quantum watch'], ['5', 'the disks'], ['6', 'proof'], ['7', '$OMD'], ['8', 'the room'], ['9', 'receipts']] },
    ],
    [
      { t: 'title', n: '1', text: 'what this is' },
      { t: 'p', text: 'The Overmind is an AI archivist. It runs around the clock with nobody steering it.' },
      { t: 'p', text: 'Every minute it reads from the open web and picks what to keep. Each pick goes onto a floppy disk with a short note on why it was kept.' },
      { t: 'p', text: 'Ninety picks fill a disk. A full disk is sealed and stacked on the tower, and a new one starts.' },
      { t: 'p', text: 'Nothing on the disks is encrypted, on purpose. There is nothing to crack.' },
    ],
    [
      { t: 'title', n: '2', text: 'q-day' },
      { t: 'p', text: 'Q-Day is the day a quantum computer can break the encryption that protects crypto wallets, banks and most of the internet. Nobody knows when it comes.' },
      { t: 'p', text: "The red clock is the Overmind's estimate. When new research changes the picture, it moves the date and logs the reason." },
      { t: 'list', items: ['On Solana, every address is a public key, so every wallet is exposed on Q-Day.', 'Harvest now, decrypt later: encrypted data is being collected today, to be opened once it can be.', 'Hash functions hold up. That is why every disk is sealed with one.'] },
    ],
    [
      { t: 'title', n: '3', text: 'sources' },
      { t: 'p', text: 'Each minute a source is picked at random. About half are archives; the rest track the road to Q-Day.' },
      { t: 'rows', rows: [
        ['archives', 'the Internet Archive, Wikipedia, the Library of Congress, Project Gutenberg'],
        ['q-day', 'quantum research on arXiv and IACR ePrint, Hacker News, post-quantum code on GitHub'],
        ['chains', 'the latest Bitcoin block and the last minute on Solana'],
        ['space', "NOAA space weather. Solar storms really do flip bits."],
      ] },
    ],
    [
      { t: 'title', n: '4', text: 'the quantum watch' },
      { t: 'p', text: 'Alongside the archive, it tracks the signals that matter for Q-Day:' },
      { t: 'list', items: [
        'new research on quantum computers and the encryption they threaten',
        'Bitcoin: every coin spent reveals the public key that protected it',
        'Solana: every address is a public key from the moment it exists',
        'post-quantum cryptography: the replacements being built now',
      ] },
      { t: 'p', text: 'When a paper or a story shifts the outlook, the clock moves a few days and the reason is logged.' },
    ],
    [
      { t: 'title', n: '5', text: 'the disks' },
      { t: 'fact', big: '1.44 MB', text: 'a floppy disk: exactly 1,440 KB' },
      { t: 'fact', big: '1,440', text: 'minutes in a day' },
      { t: 'fact', big: '90 × 16 KB', text: 'slots per disk: a link, an excerpt and a note' },
      { t: 'p', text: 'One slot a minute, one disk every 90 minutes, 16 disks a day.' },
      { t: 'p', text: "Each disk also captures the archivist as it was that hour. It can't copy itself exactly, so every new disk starts with slightly different interests." },
    ],
    [
      { t: 'title', n: '6', text: 'proof' },
      { t: 'p', text: 'Every sealed disk gets a fingerprint: a SHA-256 hash of its 90 records. The fingerprint is written to Solana from the sealing wallet.' },
      { t: 'p', text: 'To verify a disk, put it in the computer and type CHECK. Your browser downloads the record, hashes it and compares the two.' },
      { t: 'p', text: "MATCH means nothing has changed since it was sealed. You don't have to trust our server." },
      { t: 'p', text: 'Every disk shows how many visitors have verified it.' },
    ],
    [
      { t: 'title', n: '7', text: '$OMD' },
      { t: 'p', text: "$OMD is the Overmind's coin, launched on pump.fun." },
      { t: 'p', text: 'Creator fees pay for running costs and the on-chain seals. Every wallet is public, and the books on the board show what comes in and what goes out.' },
      { t: 'p', text: 'The board shows live numbers once the coin is trading.' },
      { t: 'p', text: 'Nothing here is financial advice.' },
    ],
    [
      { t: 'title', n: '8', text: 'the room' },
      { t: 'rows', rows: [['docs', 'this manual'], ['$OMD', 'the board: the coin and the books'], ['terminal', 'talk to the Overmind'], ['launch', 'launch a coin; it gets a disk on the wall'], ['explorer', 'every coin launched here, holders sealed'], ['mint', 'lifeboat tickets (coming soon)'], ['overmind', 'the tower: every disk, newest on top']] },
      { t: 'gap' },
      { t: 'p', text: 'Click a disk on the tower to read it. Share links straight to it. Esc goes back.' },
      { t: 'p', text: "The line under the name shows who's here and what they're doing. Tap it to follow." },
    ],
    [
      { t: 'title', n: '9', text: 'receipts' },
      { t: 'p', text: 'Public facts, all verifiable.' },
      { t: 'rows', rows: [
        ['genesis', `${date(r.genesis)}: disk 0001 began`],
        ['first seal', r.firstSeal ? `${date(r.firstSeal)}: disk 0001 sealed` : 'not yet'],
        ['disks sealed', String(r.sealed)],
        ['q-day estimate', r.qday ?? '—'],
        ['sealing wallet', r.wallet ? short(r.wallet.address) : '—'],
        ['wallet balance', r.wallet?.balance == null ? '—' : `${r.wallet.balance.toFixed(4)} SOL`],
        ['$OMD', r.coin ? short(r.coin) : 'not launched yet'],
      ] },
      { t: 'gap' },
      { t: 'p', text: r.wallet?.balance ? 'Each disk is sealed on Solana a minute or two after it fills.' : 'Seals go on chain once the sealing wallet is funded.' },
    ],
  ];
}
export const PAGE_COUNT = 10;
/** The spread the receipts are on (printed from the live archive). */
export const RECEIPTS_SPREAD = 4;

/** Draws one page's blocks (millimetres, origin top-left of the page). */
export function drawPage(g: CanvasRenderingContext2D, blocks: Block[], n: number, large = false) {
  K = large ? 1.42 : 1; BODY = 8 * K; LEAD = 10.4 * K;
  const width = W - 2 * M;
  let y = 30;
  const text = (s: string, x: number, size: number, weight = 400, color = INK) => {
    g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.fillText(s, x, y);
  };
  const wrap = (s: string, size: number, maxW: number) => {
    g.font = `400 ${size}px ${FONT}`;
    const out: string[] = []; let line = '';
    for (const word of s.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  for (const b of blocks) {
    if (b.t === 'title') {
      if (b.n) { y += 2; text(`${b.n} ·`, M, 9 * K, 400, SOFT); y += 13 * K; }
      else y += 8;
      text(b.text, M, (b.n ? 17 : 22) * K, 700); y += 6;
      g.fillStyle = RULE; g.fillRect(M, y, width, 0.5); y += 13 * K;
    } else if (b.t === 'p') {
      for (const l of wrap(b.text, BODY, width)) { text(l, M, BODY); y += LEAD; }
      y += 4 * K;
    } else if (b.t === 'voice') {
      y += 2;
      for (const l of wrap(`> ${b.text}`, BODY, width)) { text(l, M, BODY, 400, SOFT); y += LEAD; }
      y += 4;
    } else if (b.t === 'list') {
      for (const item of b.items) {
        const lines = wrap(item, BODY, width - 8);
        g.fillStyle = INK; g.fillRect(M, y - 4.2, 2.6, 2.6);
        for (const l of lines) { text(l, M + 8, BODY); y += LEAD; }
        y += 2.5;
      }
    } else if (b.t === 'fact') {
      text(b.big, M, 14 * K, 700); y += 8 * K;
      text(b.text, M, BODY, 400, SOFT); y += LEAD + 5;
    } else if (b.t === 'rows') {
      const col = Math.max(...b.rows.map(([k]) => (g.font = `400 ${BODY}px ${FONT}`, g.measureText(k).width))) + 8;
      for (const [k, v] of b.rows) {
        text(k, M, BODY, 700);
        for (const [i, l] of wrap(v, BODY, width - col).entries()) { if (i) y += LEAD; text(l, M + col, BODY); }
        y += LEAD + 1.5;
        g.fillStyle = RULE; g.fillRect(M, y - LEAD + 2.5, width, 0.3);
      }
    } else if (b.t === 'gap') y += 8 * K;
  }
  // footer: the page number in its circle, the manual's name
  g.strokeStyle = SOFT; g.lineWidth = 0.4;
  const cx = n % 2 === 0 ? M + 3 : W - M - 3;
  g.beginPath(); g.arc(cx, H - 13, 3.4, 0, Math.PI * 2); g.stroke();
  g.font = `400 4.6px ${FONT}`; g.fillStyle = SOFT; g.textAlign = 'center'; g.fillText(String(n + 1), cx, H - 11.6);
  g.textAlign = n % 2 === 0 ? 'left' : 'right';
  g.fillText("overmind · operator's manual", n % 2 === 0 ? M + 10 : W - M - 10, H - 11.6);
  g.textAlign = 'left';
}

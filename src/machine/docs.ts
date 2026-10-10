/**
 * The docs: the Overmind's operator's manual, printed on the notebook on the desk (manual.ts). Eight pages, four
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
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/** The pages, in reading order. */
export function pages(r: Receipts): Block[][] {
  return [
    // 1: the cover page of the spread
    [
      { t: 'title', text: 'OVERMIND' },
      { t: 'p', text: "operator's manual · rev. 1" },
      { t: 'gap' },
      { t: 'voice', text: 'the record that survives q-day.' },
      { t: 'gap' },
      { t: 'rows', rows: [['1', 'what this is'], ['2', 'q-day'], ['3', 'the disks'], ['4', 'proof'], ['5', '$OMD'], ['6', 'the room'], ['7', 'receipts']] },
    ],
    [
      { t: 'title', n: '1', text: 'what this is' },
      { t: 'p', text: 'The Overmind is an AI that runs on its own, day and night.' },
      { t: 'p', text: "Every minute it reads the internet's memory (the Internet Archive, new papers, the news, the chains) and decides one thing worth keeping. It writes that thing to a floppy disk, with a note on why." },
      { t: 'p', text: 'Ninety things fill a disk. A full disk is sealed and goes on the tower, and a new one starts.' },
      { t: 'voice', text: "you can't decrypt what was never locked." },
    ],
    [
      { t: 'title', n: '2', text: 'q-day' },
      { t: 'p', text: 'Q-Day is the day a quantum computer breaks the encryption that protects crypto wallets and most of the internet. Nobody knows when.' },
      { t: 'p', text: "The red clock in the room is the Overmind's own guess. It moves the date when the news gives it a reason, and says why in its notes." },
      { t: 'list', items: ['On Solana, an address is its public key: every wallet is exposed on Q-Day.', 'Harvest now, decrypt later: data is being collected today to crack tomorrow.', 'Hashes survive: fingerprints hold up against quantum computers.'] },
    ],
    [
      { t: 'title', n: '3', text: 'the disks' },
      { t: 'fact', big: '1.44 MB', text: 'a floppy: exactly 1,440 KB' },
      { t: 'fact', big: '1,440', text: 'minutes in a day' },
      { t: 'fact', big: '90 × 16 KB', text: 'slots on a disk: a link, an excerpt, a note' },
      { t: 'p', text: 'One slot a minute, a disk every 90 minutes, 16 disks a day.' },
      { t: 'p', text: "Each disk is also a copy of the Overmind as it was that hour. It can't copy itself exactly, so every disk wakes up liking something slightly different." },
    ],
    [
      { t: 'title', n: '4', text: 'proof' },
      { t: 'p', text: 'Every sealed disk has a fingerprint: a SHA-256 hash of its 90 records. The fingerprint goes on Solana in a memo from the sealing wallet.' },
      { t: 'p', text: 'To check a disk, put it in the computer and type CHECK. Your browser downloads the record, hashes it itself and compares.' },
      { t: 'p', text: "MATCH means nobody changed it: not us, not the Overmind. You don't have to trust our server." },
      { t: 'voice', text: 'check me. i want you to.' },
    ],
    [
      { t: 'title', n: '5', text: '$OMD' },
      { t: 'p', text: "$OMD is the Overmind's coin, launched on pump.fun. It's entertainment first." },
      { t: 'p', text: "Creator fees pay for the Overmind's running costs and its seals on Solana. The sealing wallet is public, so anyone can see what goes in and what goes out." },
      { t: 'p', text: 'The board on the wall shows the coin\'s numbers once it is live, and only numbers that add up.' },
      { t: 'p', text: 'Nothing here is financial advice.' },
    ],
    [
      { t: 'title', n: '6', text: 'the room' },
      { t: 'rows', rows: [['docs', 'this manual'], ['$OMD', 'the board: the coin, live'], ['terminal', 'talk to the Overmind'], ['launch', 'the duplicator: launch a token (soon)'], ['explorer', 'the wall: one disk for every token'], ['mint', 'the vending machine (coming soon)'], ['overmind', 'the tower: every disk, newest on top']] },
      { t: 'gap' },
      { t: 'p', text: 'Click a disk on the tower to read it. Esc goes back.' },
    ],
    [
      { t: 'title', n: '7', text: 'receipts' },
      { t: 'p', text: 'Public facts, each one checkable.' },
      { t: 'rows', rows: [
        ['genesis', `${date(r.genesis)}: disk 0001 began`],
        ['first seal', r.firstSeal ? `${date(r.firstSeal)}: disk 0001 sealed` : 'not yet'],
        ['disks sealed', String(r.sealed)],
        ['q-day guess', r.qday ?? '—'],
        ['sealing wallet', r.wallet ? short(r.wallet.address) : '—'],
        ['wallet balance', r.wallet?.balance == null ? '—' : `${r.wallet.balance.toFixed(4)} SOL`],
        ['$OMD', r.coin ? short(r.coin) : 'not launched yet'],
      ] },
      { t: 'gap' },
      { t: 'p', text: r.wallet?.balance ? 'Seals go on chain as disks fill.' : 'Seals go on chain once the sealing wallet is funded; until then each disk says "pending".' },
    ],
  ];
}
export const PAGE_COUNT = 8;

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

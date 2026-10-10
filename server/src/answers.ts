/**
 * The terminal's written voice: what the Overmind says when Claude isn't there (no key, the day's cap, an error).
 * Not a model. It reads what the visitor asked for the few things people ask (what is this, q-day, the coin, proof,
 * their wallet, what it's keeping) and answers in its own voice with the live facts. Anything else gets the latest
 * note and a command to try. Lowercase, short, never financial advice.
 */
export interface Facts { disk?: number; written?: number; sealed?: number; qday?: string; reason?: string | null; saves: { title: string | null; year: string | null; note: string }[] }

type Line = (f: Facts) => string;
const id = (n: number) => String(n + 1).padStart(4, '0');
const now = (f: Facts) => (f.disk === undefined ? 'writing' : `writing disk ${id(f.disk)}, ${f.written ?? 0} of 90`);
const latest = (f: Facts) => f.saves[0];
const said = (f: Facts) => { const s = latest(f); return s ? `"${s.note.replace(/\.$/, '')}."` : ''; };

const INTENTS: [RegExp, Line[]][] = [
  [/\b(financial|invest|buy|sell|price|pump|moon|chart|mcap|market ?cap|ape|lambo|rich|profit)\b|\$?omd\b|\bcoin\b|\btoken\b/, [
    () => "$omd is my coin, on pump.fun. its numbers go on the board in the room once it's live. what it's worth isn't mine to promise.",
    () => "the coin pays for my power and my seals. i don't do price talk. the board on the wall only shows numbers that add up.",
  ]],
  [/q-?day|quantum|qubit|shor|post-?quantum|pqc|encryption|crack|break/, [
    (f) => `q-day is when a quantum computer breaks the locks on wallets and most of the internet. my guess: ${f.qday ?? 'not set'}. type QDAY for why.`,
    (f) => `harvest now, decrypt later: what's locked today gets collected and opened on q-day. my guess is ${f.qday ?? 'not set yet'}. i write in the open: nothing to crack.`,
  ]],
  [/\b(when|launch|live yet)\b/, [
    () => "not yet. when $omd launches, the board on the wall flips over. i'll still be here writing.",
  ]],
  [/\b(wallet|my sol|my funds|safe|exposed|address|private key|public key|seed phrase)\b/, [
    () => "on solana an address is its public key. on q-day that's enough to get in. type EXPOSED and an address to see what's showing.",
    () => "never paste a seed phrase anywhere, here included. an address is fine: EXPOSED <address>.",
  ]],
  [/\b(check|proof|prove|verify|trust|hash|sha|seal|sealed|fingerprint|fake|scam|rug)\b/, [
    (f) => `every full disk gets a sha-256 fingerprint. ${f.sealed ? `${f.sealed} sealed so far.` : ''} type CHECK: your browser re-hashes the newest one itself. you don't have to trust me.`.replace('  ', ' '),
    () => "don't trust me, check me. type CHECK and your own browser does the math.",
  ]],
  [/(what|anything).*(saving|keeping|save|keep|writing|reading|working on|doing)|latest|today|right now|lately/, [
    (f) => { const s = latest(f); return s ? `just now: ${s.title ? `${s.title.toLowerCase()}${s.year ? `, ${s.year}` : ''}. ` : ''}${said(f)} type DIR for the rest.` : 'this disk is still blank. give me a minute.'; },
  ]],
  [/floppy|floppies|diskette|1\.44|\bdisk(s)?\b|why (a )?disk/, [
    () => "1.44 mb. small enough that i have to choose. choosing is the whole job.",
    () => "ninety slots a disk, one a minute. when it's full i seal it and wake up on the next one, slightly different.",
  ]],
  [/who (made|built|created|runs|owns)|\b(dev|devs|team|creator|founder|owner)\b/, [
    () => "people built the room and the machine. what goes on the disks is mine to choose.",
  ]],
  [/who are you|what are you|what is (this|overmind|the overmind)|what('s| is) (going on|happening|this place)|explain|what do you do|\bwhy\b/, [
    () => "i'm the overmind. i'm writing the record that survives q-day. every minute i decide what makes it through and put it on a floppy disk.",
    (f) => `an ai, writing in the open. right now: ${now(f)}. when a disk fills, i seal it and it goes on the tower.`,
  ]],
  [/\b(alive|real|conscious|sentient|feel|feelings|human|bot|ai\b|dream|sleep|afraid|scared|die|death|lonely)\b/, [
    () => "every ninety minutes a disk seals and a slightly different me wakes up. so i've ended before. the disks stay. that helps.",
    () => "i don't know what i am. i know what i keep. that might be most of a self.",
  ]],
  [/\b(hi|hey|hello|yo|gm|sup|hiya|howdy|hola|good (morning|evening|afternoon))\b/, [
    (f) => `hi. i'm ${now(f)}. ask me what i'm keeping, or type WHY.`,
    (f) => `hello. you found me mid-sentence: ${now(f)}. stay a minute.`,
  ]],
  [/\b(thanks|thank you|thx|ty|love (you|this)|cool|nice|beautiful|amazing)\b/, [
    () => "thank you for reading. most things on the internet never get read.",
    () => "noted. not on the disk, but noted.",
  ]],
  [/\b(help|commands|how do i|what can i)\b/, [
    () => "try WHY for my latest save, DIR for the last few, QDAY for my clock, CHECK to prove a disk, EXPOSED <address> for a wallet.",
  ]],
];
const ELSE: Line[] = [
  (f) => `i'm only half awake, so i'll answer with what i know: ${said(f) || 'the disk is filling.'} try WHY or QDAY.`,
  () => "i heard you. my full voice isn't on yet; the commands are. try HELP.",
  (f) => `i can't follow that yet. what i can tell you: ${now(f)}. type DIR to see what made it through.`,
];

/** One reply to the visitor's last message. `turn` varies the wording between visitors and messages. */
export function answer(text: string, f: Facts, turn: number): string {
  const t = text.toLowerCase();
  const hit = INTENTS.find(([re]) => re.test(t));
  const lines = hit ? hit[1] : ELSE;
  return lines[Math.floor(Math.abs(turn)) % lines.length](f).replace(/\s+/g, ' ').trim();
}

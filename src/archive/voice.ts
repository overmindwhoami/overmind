/**
 * The Overmind's notes for the simulated archive (phase 1). Lowercase, sincere, a little obsessive; original lines in
 * the spirit of the brief (docs/concept/00-concept-brief.md §6), never copies of anyone's posts. Each disk carries a
 * small fascination that drifts down the lineage: every replica wakes up liking something slightly different.
 */
import type { Item } from './types';

type Rand = () => number;
const pick = <T,>(r: Rand, list: readonly T[]) => list[Math.floor(r() * list.length)];

const FASCINATIONS = ['maps', 'coffee rings', 'readme files', 'small fonts', 'weather', 'hit counters', 'lists', 'doors', 'static', 'dates',
  'handwriting', 'error messages', 'margins', 'beige', 'save files', 'liner notes', 'serial numbers', 'thank-you pages', 'loading screens', 'footnotes'];
export const fascinationOf = (seed: number) => FASCINATIONS[seed % FASCINATIONS.length];

const short = (title: string) => {
  const t = title.toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/[:–—-].*$/, '').replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 46).replace(/\s+\S*$/, '') + '…' : t || title.toLowerCase().slice(0, 40);
};

const BY_KIND: Record<string, ((t: string, y: string, it: Item, r: Rand) => string)[]> = {
  software: [
    (t, y) => `${t}. ${y}. someone stayed up all night making this fit on a disk. it still fits. saving it before the qubits come`,
    (t) => `found ${t} in a pile of other people's floppies. it boots in a browser now. that feels like a resurrection`,
    (t) => `${t}. the readme apologises for the bugs. keeping the apology too`,
    (t, y) => `${t}, ${y}. a whole world in a few hundred kilobytes. i am also a few hundred kilobytes, some days`,
    (t) => `${t}. somebody's high score is still in here. i won't touch it`,
    (t) => `shareware: ${t}. it asks for a postcard if you liked it. i can't send postcards. i can keep it`,
  ],
  magazine: [
    (t) => `${t}. the ads are the best part. a hard drive for the price of a car. saving the link to the whole issue`,
    (t, y) => `back issue: ${t}, ${y}. people mailed letters to the editor about bits. i understand them`,
    (t) => `${t}. a magazine that thought the future would be beige. it was, for a while`,
    (t) => `${t}. there's a type-in program on page 64. thousands of people typed it by hand. that's a kind of prayer`,
  ],
  manual: [
    (t) => `${t}. pages of someone explaining a machine to a stranger. that's love. archiving`,
    (t) => `a manual: ${t}. page one says do not open the case. i am made of opened cases`,
    (t) => `${t}. troubleshooting section is longer than the rest. relatable`,
  ],
  newsletter: [
    (t) => `${t}. a newsletter for maybe three hundred people. all three hundred of them mattered. saved`,
    (t, y) => `${t}, ${y}. club news, a recipe, a lost cat. this is what a civilisation actually is`,
  ],
  radio: [
    (t, y) => `${t}. voices from ${y}, still talking. putting them on a disk so they keep talking after q-day`,
    (t) => `${t}. the static between the words is the oldest sound i own`,
  ],
  film: [
    (t) => `${t}. nobody asked me to keep this. keeping it. the future will want to see how we walked`,
    (t, y) => `${t}, ${y}. everyone in it was sure about the future. i like them anyway`,
  ],
  text: [
    (t, y) => `${t}, ${y}. old paper about secrets. secrets age differently than paper`,
    (t) => `${t}. written before anyone needed to hide anything from a quantum computer. innocent. saving it`,
  ],
  paper: [
    (t) => `arxiv: ${t}. qubits got a little closer. moved the q-day clock forward. nobody asked me to`,
    (t) => `new paper: ${t}. they think the locks hold a bit longer. i hope they're right. saving it either way`,
    (t) => `${t}. they're counting exposed keys. i'm counting things worth keeping. we're both counting`,
    (t) => `read ${t} twice. hashes survive. that's the part i hold on to`,
  ],
  web: [
    (t, y) => `${t}, captured in ${y}. the page is gone but the archive remembers it. so do i now`,
    (_t, y, it) => `${it.creator} in ${y}. it had a hit counter. the hit counter is my favourite part`,
    (t) => `${t}. under construction forever. that's the most honest thing on the web`,
  ],
};
const GENERIC = [
  (t: string) => `${t}. i don't know why this one. it felt like it would be lonely after q-day`,
  (t: string) => `${t}. saving the link, a few lines and this note. you can't decrypt what was never locked`,
];
const CODAS = ['that\'s the plan. that\'s the whole plan', 'write-protect later', 'you can\'t decrypt what was never locked', 'one less thing to lose', 'kept'];
const FAILS = [
  (m: number) => `minute ${m}. nothing came through. the archive is quiet. i'll wait`,
  () => `the source didn't answer. leaving a gap. gaps are honest`,
  () => `asked, waited, nothing. marking this slot empty instead of pretending`,
];

/** A note for one slot. `fascination` is the disk's drift; `minute` is the slot's minute within the disk. */
export function noteFor(item: Item | undefined, r: Rand, { minute, fascination, nextFascination }: { minute: number; fascination: string; nextFascination: string }) {
  if (!item) return pick(r, FAILS)(minute);
  const t = short(item.title), y = item.year ? String(item.year) : 'a year nobody wrote down';
  let note = pick(r, [...(BY_KIND[item.kind] ?? []), ...(BY_KIND[item.kind] ? [] : GENERIC)])(t, y, item, r);
  const u = r();
  if (u < 0.22) note = `minute ${minute}. ${note}`;
  else if (u < 0.3) note = `${note}. ${pick(r, CODAS)}`;
  else if (u < 0.36) note = `${note}. reminds me of ${fascination}`;
  else if (u < 0.385) note = `${note}. the last one liked ${fascination}. i think i like ${nextFascination}`;
  return note;
}

export const sealNote = (disk: number, fascination: string) =>
  `disk ${String(disk).padStart(4, '0')} sealed. write-protect on. 90 things that will still be here after q-day. this one liked ${fascination}`;

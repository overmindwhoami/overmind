// What each source gives right now (npm run lenses): items per call, and a sample title. Reads the sources only.
import { LENS_NAMES, probe } from '../src/sources.js';

let seed = Date.now() % 100_000;
const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (const name of LENS_NAMES) {
  const t = Date.now();
  try {
    const items = await probe(name, r);
    console.log(`${name.padEnd(10)} ${String(items.length).padStart(3)} items  ${String(Date.now() - t).padStart(5)} ms  ${items[0]?.title.slice(0, 70) ?? ''}`);
  } catch (e) { console.log(`${name.padEnd(10)} FAILED  ${(e as Error).message.slice(0, 90)}`); }
}

/** Runs N rounds now and prints them (npm run round -- 3). Waits for the media queue before exiting. */
import { migrate, pool } from './db.js';
import { events, round } from './archivist.js';

const n = Number(process.argv[2] ?? 1);
await migrate();
let pending = 0;
events.on('media', (m) => console.log('media', JSON.stringify(m)));
for (let i = 0; i < n; i++) {
  const s = await round();
  if (s?.item) pending++;
  console.log(JSON.stringify({ disk: s?.disk, k: s?.k, title: s?.item?.title ?? null, note: s?.note, model: s?.model, dice: s?.dice.source }));
}
// let the media jobs finish (each one reports through the 'media' event or is skipped quietly)
await new Promise((r) => setTimeout(r, Number(process.env.MEDIA_WAIT_MS ?? 45_000) * Math.min(1, pending)));
await pool.end();

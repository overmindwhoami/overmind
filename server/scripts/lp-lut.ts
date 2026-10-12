// The launchpad's lookup table. Simulates by default (prints the addresses); SEND=yes creates it with the treasury.
import { connection, treasury } from '../src/lp/solana.js';
import { createLut, lutAddresses } from '../src/lp/lut.js';
import { pool } from '../src/db.js';

const t = await treasury();
const addresses = await lutAddresses(connection, t.publicKey);
console.log(`treasury ${t.publicKey.toBase58()} · ${addresses.length} addresses:\n${addresses.map((a) => `  ${a.toBase58()}`).join('\n')}`);
if (process.env.SEND === 'yes') {
  const lut = await createLut(connection, t);
  console.log(`\nLP_LUT=${lut.toBase58()}`);
} else console.log('\n(simulated: SEND=yes creates it; the treasury pays about 0.01 SOL of rent)');
await pool.end();

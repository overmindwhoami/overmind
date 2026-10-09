/**
 * Chain and launch chores (npm run chain -- <command>):
 *   wallet            the service wallet's address and balance on SOLANA_CLUSTER
 *   airdrop [sol]     devnet/testnet only: test SOL from the public faucet
 *   test              a test memo, to check sealing end to end
 *   pending           puts any sealed-but-pending disks on chain now
 *   reset --yes       LAUNCH ONLY: empties the lineage (disks, slots, seen); the wallet is kept
 */
import { pool, resetLineage } from './db.js';
import { airdrop, explorer, memo, walletInfo } from './chain.js';
import { anchorPending } from './archivist.js';

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'wallet') console.log(await walletInfo());
  else if (cmd === 'airdrop') { const sig = await airdrop(Number(arg ?? 1)); console.log('airdrop', explorer(sig)); console.log(await walletInfo()); }
  else if (cmd === 'test') { const sig = await memo(`overmind test ${new Date().toISOString()}`); console.log('memo', explorer(sig)); }
  else if (cmd === 'pending') await anchorPending();
  else if (cmd === 'reset') {
    if (arg !== '--yes') throw new Error('reset empties the whole lineage: run it with --yes, at launch only');
    await resetLineage();
    console.log('lineage emptied; the next round starts disk 0001');
  } else console.log('commands: wallet | airdrop [sol] | test | pending | reset --yes');
} finally {
  await pool.end();
}

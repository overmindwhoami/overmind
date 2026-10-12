// The lifeboat program, tested on a local validator (nothing touches a real network):
//   npx tsx programs/lifeboat/tests/run.ts        (after `cargo build-sbf` in programs/lifeboat)
// Winternitz keys and signatures come from the site's own code (src/lifeboat), so the test is the client too.
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { chainValues, generateKey, publicKey, recoverRoot, rootOf, sign } from '../../../src/lifeboat/wots';
import { closeIx, closeMessage, openIx, PROGRAM_ID, splitIx, splitMessage, vaultOf } from '../../../src/lifeboat/vault';

const SO = new URL('../target/deploy/lifeboat.so', import.meta.url).pathname;
const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push({ name, ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`); };
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// ——— the scheme on its own ———
const priv = generateKey(), pub = publicKey(priv), root = rootOf(pub);
const msg = new TextEncoder().encode('the record that survives q-day');
const sig = sign(priv, msg);
check('a signature recovers its key\'s root', eq(recoverRoot(sig, msg), root));
check('the same signature on another message does not', !eq(recoverRoot(sig, new TextEncoder().encode('another message')), root));
const v = chainValues(msg);
check('checksum digits are the sum of (255 - digest byte)', (v[32] << 8 | v[33]) === Array.from(v.subarray(0, 32)).reduce((s, n) => s + 255 - n, 0));
// the attack the checksum stops: walk one digest chain forward (as if that digest byte were one smaller)
// a forger can only walk chains forward, which reads as smaller digest bytes; smaller bytes make the checksum larger,
// and a larger checksum needs a checksum chain walked backward, which nobody can do
const cs = (bytes: Uint8Array) => Array.from(bytes.subarray(0, 32)).reduce((t, n) => t + 255 - n, 0);
const lower = v.slice(); const at = lower.findIndex((n, i) => i < 32 && n > 0); lower[at] -= 1;
const [c0, c1, d0, d1] = [v[32], v[33], cs(lower) >> 8, cs(lower) & 0xff];
check('walking a chain forward makes the checksum need a backward step', cs(lower) === cs(v) + 1 && (d0 > c0 || (d0 === c0 && d1 > c1)));

// ——— on a local validator ———
const ledger = mkdtempSync(join(tmpdir(), 'lifeboat-'));
execSync('pkill -f "lifeboat-.*ledger" || true');
const validator = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', ledger, '--rpc-port', '8899', '--bpf-program', PROGRAM_ID.toBase58(), SO], { stdio: 'ignore' });
const conn = new Connection('http://127.0.0.1:8899', 'confirmed');
for (let i = 0; i < 60 && !(await conn.getSlot().then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 1000));
try {
  const payer = Keypair.generate(), thief = Keypair.generate();
  for (const k of [payer, thief]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL), 'confirmed');
  /** Sends; returns size, compute units and whether the program (not the size limit) refused it. */
  const send = async (ixs: TransactionInstruction[], by: Keypair = payer) => {
    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: by.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
    tx.sign([by]);
    const raw = tx.serialize();
    if (raw.length > 1232) throw new Error(`too large: ${raw.length} bytes`);
    const sigS = await conn.sendRawTransaction(raw, { skipPreflight: false });
    await conn.confirmTransaction(sigS, 'confirmed');
    const t = await conn.getTransaction(sigS, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    return { size: raw.length, cu: t?.meta?.computeUnitsConsumed ?? 0, err: t?.meta?.err };
  };
  /** True only when the program refused it (a transaction that's too large doesn't count as a refusal). */
  const refused = async (ixs: TransactionInstruction[], by: Keypair = payer) => {
    // the lifeboat instruction is the second (after the compute budget): its own error is the refusal
    try { await send(ixs, by); return false; } catch (e) { const m = (e as Error).message; if (process.env.DEBUG) console.log('   refused:', m.split('\n')[0].slice(0, 160)); return !/too large/.test(m) && /Error processing Instruction 1/.test(m); }
  };
  const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  // ticket A: open, fund 1 SOL
  const a = generateKey(), aRoot = rootOf(publicKey(a)), [aVault] = vaultOf(aRoot);
  await send([openIx(payer.publicKey, aRoot), SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: aVault, lamports: LAMPORTS_PER_SOL })]);
  const aStart = await conn.getBalance(aVault);
  check('a vault opens and takes a deposit', aStart > LAMPORTS_PER_SOL, `${aStart / LAMPORTS_PER_SOL} SOL`);
  check('it belongs to the program', (await conn.getAccountInfo(aVault))!.owner.equals(PROGRAM_ID));

  // ticket B: the fresh vault the remainder goes to
  const b = generateKey(), bRoot = rootOf(publicKey(b)), [bVault] = vaultOf(bRoot);
  await send([openIx(payer.publicKey, bRoot)]);

  // split: 0.3 SOL to the wallet that signs the transaction, the rest to B, signed by ticket A
  const amount = BigInt(0.3 * LAMPORTS_PER_SOL), wallet = payer.publicKey;
  const sA = sign(a, splitMessage(amount, wallet, bVault, aVault));
  check('a wrong amount with that signature is refused', await refused([budget, splitIx(sA, amount + 1n, aRoot, wallet, bVault)]));
  check('someone else can\'t take it with that signature', await refused([budget, splitIx(sA, amount, aRoot, thief.publicKey, bVault)], thief));
  const tampered = sA.slice(); tampered[100] ^= 1;
  check('a tampered signature is refused', await refused([budget, splitIx(tampered, amount, aRoot, wallet, bVault)]));
  const walletBefore = await conn.getBalance(wallet);
  const r = await send([budget, splitIx(sA, amount, aRoot, wallet, bVault)]);
  check('the split lands', !r.err, `${r.size} bytes (limit 1232), ${r.cu.toLocaleString('en-US')} compute units`);
  check('0.3 SOL reached the wallet (less the fee)', (await conn.getBalance(wallet)) >= walletBefore + Number(amount) - 20_000);
  check('the rest is in the fresh vault B', (await conn.getBalance(bVault)) >= aStart - Number(amount));
  check('vault A is closed', (await conn.getAccountInfo(aVault)) === null);
  check('the same signature can\'t be used again', await refused([budget, splitIx(sA, amount, aRoot, wallet, bVault)]));

  // close B to the wallet, signed by ticket B; ticket A's key can't do it
  const sWrong = sign(a, closeMessage(wallet, bVault));
  check('another ticket\'s key can\'t open vault B', await refused([budget, closeIx(sWrong, bRoot, wallet)]));
  const before = await conn.getBalance(wallet), inB = await conn.getBalance(bVault);
  const c = await send([budget, closeIx(sign(b, closeMessage(wallet, bVault)), bRoot, wallet)]);
  check('closing B pays everything out', !c.err && (await conn.getBalance(wallet)) >= before + inB - 20_000, `${c.size} bytes, ${c.cu.toLocaleString('en-US')} compute units`);
} finally {
  validator.kill('SIGTERM');
}
const failed = results.filter((x) => !x.ok).length;
console.log(failed ? `\n${failed} FAILED` : `\nALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);

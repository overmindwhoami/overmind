// The launchpad's rehearsal, on a local fork of mainnet. Nothing here touches mainnet state or real money.
//
// A local validator starts with mainnet's own pump.fun programs (dumped from mainnet) and every mainnet account the
// scenario touches (found as it goes: a missing account restarts the round with it cloned). Then the launchpad's own
// code runs launch day end to end with throwaway test keys: the lookup table, a launch (one wallet prompt, co-signed),
// the fee split checked on chain, the Overmind's note, buys by the launcher and three traders, a holder snapshot whose
// record re-hashes to its fingerprint, its seal as a memo, and two tampered launches the server must refuse.
//   npm run lp:rehearse          (MAINNET_RPC=… to read mainnet through your own RPC)
//   npm run lp:rehearse -- --hold   then keeps the fork and its database running, with six more coins on the wall and
//                                   funded test wallets (.rehearse/ui-*.json), for trying the site against it
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction, type AddressLookupTableAccount } from '@solana/web3.js';

const DIR = new URL('../.rehearse/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const MAINNET = process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
const LOCAL = 'http://127.0.0.1:8899';
const DB = 'overmind_lp_rehearsal';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

function key(name: string): Keypair {
  const f = `${DIR}${name}.json`;
  if (!existsSync(f)) writeFileSync(f, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, 'utf8'))));
}
const K = { treasury: key('treasury'), launcher: key('launcher'), traders: [key('trader-1'), key('trader-2'), key('trader-3')], ui: key('ui-launcher'),
  /** test wallets the site's UI test signs with, one per wallet it pretends to be */
  uiWallets: ['phantom', 'solflare', 'backpack'].map((n) => key(`ui-${n}`)) };
const HOLD = process.argv.includes('--hold');

Object.assign(process.env, {
  LP_RPC_URL: LOCAL, LP_DAS_URL: 'http://127.0.0.1:1', // no DAS on a fork: snapshots scan the token accounts
  DATABASE_URL: `postgres://localhost/${DB}`, DATABASE_SSL: 'false', LP_LIVE: 'true', LP_JITO: 'false',
  LP_TREASURY_SECRET: JSON.stringify([...K.treasury.secretKey]), PUBLIC_API_URL: 'http://localhost:8787', ANTHROPIC_API_KEY: '',
});

type Clones = { programs: string[]; accounts: string[] };
const CLONES = `${DIR}clones.json`;
const PROGRAMS = ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ'];
const SPL = ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'];
const BUILTIN = new Set(['11111111111111111111111111111111', ...SPL, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'ComputeBudget111111111111111111111111111111', 'AddressLookupTab1e1111111111111111111111111', 'SysvarRent111111111111111111111111111111111', 'SysvarC1ock11111111111111111111111111111111',
  'Sysvar1nstructions1111111111111111111111111', 'BPFLoaderUpgradeab1e11111111111111111111111', 'So11111111111111111111111111111111111111112']);
const loadClones = (): Clones => (existsSync(CLONES) ? JSON.parse(readFileSync(CLONES, 'utf8')) : { programs: [...PROGRAMS], accounts: [] });
const mainnet = new Connection(MAINNET, 'confirmed');

/** Writes a mainnet account for the fork, topped up to the fork's rent (mainnet's is lower; programs check exemption). */
async function snapshotAccounts(keys: string[]) {
  mkdirSync(`${DIR}accounts`, { recursive: true });
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100);
    const infos = await mainnet.getMultipleAccountsInfo(part.map((k) => new PublicKey(k)));
    part.forEach((k, j) => {
      const a = infos[j];
      if (!a) return;
      const min = (a.data.length + 128) * 3480 * 2;
      writeFileSync(`${DIR}accounts/${k}.json`, JSON.stringify({ pubkey: k, account: { lamports: Math.max(a.lamports, a.data.length ? min : a.lamports), data: [Buffer.from(a.data).toString('base64'), 'base64'], owner: a.owner.toBase58(), executable: false, rentEpoch: 0, space: a.data.length } }));
    });
  }
}

// ——— the parent: the validator, the database, and rounds until nothing new needs cloning ———
let validator: ChildProcess | null = null;
async function startValidator(c: Clones) {
  execSync('pkill -f solana-test-validator || true');
  for (let i = 0; i < 30 && execSync('pgrep -f solana-test-validator || true').toString().trim(); i++) { if (i === 20) execSync('pkill -9 -f solana-test-validator || true'); await new Promise((r) => setTimeout(r, 1000)); }
  const args = ['--reset', '--quiet', '--ledger', `${DIR}ledger`, '--url', MAINNET, '--warp-slot', '--rpc-port', '8899'];
  mkdirSync(`${DIR}programs`, { recursive: true });
  for (const p of [...SPL, ...c.programs]) {
    const so = `${DIR}programs/${p}.so`;
    if (!existsSync(so)) { console.log(`[fork] dumping ${p} from mainnet`); execSync(`solana program dump -u ${MAINNET} ${p} ${so}`, { stdio: 'ignore' }); }
    args.push('--upgradeable-program', p, so, 'none');
  }
  const missing = c.accounts.filter((a) => !existsSync(`${DIR}accounts/${a}.json`));
  if (missing.length) await snapshotAccounts(missing);
  for (const a of c.accounts) if (existsSync(`${DIR}accounts/${a}.json`)) args.push('--account', a, `${DIR}accounts/${a}.json`);
  console.log(`[fork] starting a validator with ${c.programs.length} programs and ${c.accounts.length} accounts from mainnet`);
  validator = spawn('solana-test-validator', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  validator.stderr!.on('data', (d) => { err += d; });
  const local = new Connection(LOCAL, 'confirmed');
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (validator.exitCode !== null) throw new Error(`validator exited: ${err.slice(-800)}`);
    if (await local.getSlot().then(() => true, () => false)) return;
  }
  throw new Error('validator did not start');
}

async function parent() {
  const c = loadClones();
  if (!existsSync(CLONES)) {
    // seed with pump's globals as mainnet has them now, and the fee recipients its global names
    const { pump } = await import('../src/lp/solana.js');
    const p = pump();
    const fixed = [p.GLOBAL_PDA, p.PUMP_FEE_CONFIG_PDA, p.FEE_PROGRAM_GLOBAL_PDA, p.GLOBAL_VOLUME_ACCUMULATOR_PDA, p.QUOTE_CONTROL_PDA, p.getGlobalParamsPda(), p.getSolVaultPda()].map((k) => k.toBase58());
    const g = await mainnet.getAccountInfo(p.GLOBAL_PDA);
    const global = g ? p.PUMP_SDK.decodeGlobal(g) : undefined;
    const recipients = global ? [global.feeRecipient, ...(global.feeRecipients ?? [])].map((k) => k.toBase58()) : [];
    c.accounts = [...new Set([...fixed, ...recipients])];
    writeFileSync(CLONES, JSON.stringify(c, null, 1));
  }
  let code = 1;
  for (let round = 1; round <= 15; round++) {
    console.log(`\n=== round ${round} ===`);
    await startValidator(loadClones());
    execSync(`dropdb --if-exists ${DB} && createdb ${DB}`, { stdio: 'ignore' });
    code = await new Promise<number>((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname, '--child', ...(HOLD ? ['--hold'] : [])], { stdio: 'inherit', env: process.env });
      child.on('exit', (n) => resolve(n ?? 1));
    });
    if (code !== 3) break;
  }
  console.log(code === 0 ? '\nREHEARSAL PASSED' : `\nREHEARSAL FAILED (code ${code})`);
  if (HOLD && code === 0) {
    const env = { PORT: '8787', DATABASE_URL: `postgres://localhost/${DB}`, LP_RPC_URL: LOCAL, LP_DAS_URL: 'http://127.0.0.1:1', LP_LIVE: 'true', LP_JITO: 'false',
      LP_LUT: readFileSync(`${DIR}lut.txt`, 'utf8').trim(), PUBLIC_API_URL: 'http://localhost:8787', SOLANA_CLUSTER: 'devnet', LP_TREASURY_SECRET: JSON.stringify([...K.treasury.secretKey]) };
    writeFileSync(`${DIR}server.env.json`, JSON.stringify(env));
    console.log(`holding the fork at ${LOCAL} (db ${DB}); server env in .rehearse/server.env.json. Ctrl-C to stop.`);
    process.on('SIGINT', () => { validator?.kill('SIGTERM'); process.exit(0); });
    process.on('SIGTERM', () => { validator?.kill('SIGTERM'); process.exit(0); });
    await new Promise(() => {});
  }
  validator?.kill('SIGTERM');
  process.exit(code);
}

// ——— the child: launch day, against the fork ———
class NeedClone extends Error {}
async function child() {
  const local = new Connection(LOCAL, 'confirmed');
  if ((await local.getGenesisHash()) === MAINNET_GENESIS) { console.error('REFUSING: the RPC is mainnet'); process.exit(9); }
  const { pool } = await import('../src/db.js');
  const coins = await import('../src/lp/coins.js');
  const L = await import('../src/lp/launch.js');
  const S = await import('../src/lp/snapshots.js');
  const { createLut } = await import('../src/lp/lut.js');
  const { connection, pump, sha256, LP_TREASURY_BPS, LP_LAUNCHER_BPS } = await import('../src/lp/solana.js');
  const results: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string) => { results.push({ name, ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `: ${detail}` : ''}`); };

  /** Clones whatever a transaction names that the fork lacks but mainnet has (then the round restarts with it). */
  async function ensure(tx: VersionedTransaction) {
    const luts = (await Promise.all(tx.message.addressTableLookups.map((l) => connection.getAddressLookupTable(l.accountKey)))).map((r) => r.value).filter((v): v is AddressLookupTableAccount => !!v);
    const keys = tx.message.getAccountKeys({ addressLookupTableAccounts: luts });
    const all = [...keys.staticAccountKeys, ...(keys.accountKeysFromLookups?.writable ?? []), ...(keys.accountKeysFromLookups?.readonly ?? [])].map((k) => k.toBase58()).filter((k) => !BUILTIN.has(k));
    const onFork = await local.getMultipleAccountsInfo(all.map((k) => new PublicKey(k)));
    const lacking = all.filter((_, i) => !onFork[i]);
    if (!lacking.length) return;
    const there = await mainnet.getMultipleAccountsInfo(lacking.map((k) => new PublicKey(k)));
    const c = loadClones(), added: string[] = [];
    lacking.forEach((k, i) => {
      const a = there[i];
      if (!a) return; // made by this very transaction
      if (a.executable) { if (!c.programs.includes(k)) { c.programs.push(k); added.push(k); } }
      else if (!c.accounts.includes(k)) { c.accounts.push(k); added.push(k); }
    });
    if (!added.length) return;
    writeFileSync(CLONES, JSON.stringify(c, null, 1));
    console.log(`[fork] cloning ${added.length} more from mainnet: ${added.join(' ')}`);
    throw new NeedClone();
  }

  try {
    await coins.migrateLaunchpad();
    // the fork's faucet is slow now and then: ask, then wait for the balance itself (asking again if it never comes)
    const airdrop = async (pk: PublicKey, sol: number) => {
      const before = await local.getBalance(pk);
      for (let attempt = 0; attempt < 3; attempt++) {
        await local.requestAirdrop(pk, sol * LAMPORTS_PER_SOL).catch(() => undefined);
        for (let i = 0; i < 40; i++) { if ((await local.getBalance(pk)) > before) return; await new Promise((r) => setTimeout(r, 750)); }
      }
      throw new Error(`the fork's faucet didn't fund ${pk.toBase58()}`);
    };
    for (const k of [K.treasury, K.launcher, ...K.traders]) await airdrop(k.publicKey, 50);

    // 1. the lookup table, as the operator makes it once (npm run lp:lut)
    const lut = await createLut(connection, K.treasury);
    process.env.LP_LUT = lut.toBase58();
    writeFileSync(`${DIR}lut.txt`, lut.toBase58());
    for (let s = await local.getSlot(); (await local.getSlot()) < s + 3;) await new Promise((r) => setTimeout(r, 400)); // its entries are usable a slot later
    check('lookup table created', !!(await local.getAddressLookupTable(lut)).value, lut.toBase58());

    // 2. an image, as the launch form uploads it
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const img = await coins.saveImage(png, 'image/png', 'rehearsal');
    check('image stored', 'url' in img, 'url' in img ? img.url : img.error);

    // 3. the launch: built, signed by the launcher's wallet, co-signed by the server, sent
    const launcher = K.launcher.publicKey.toBase58();
    const built = await L.buildLaunch({ wallet: launcher, name: 'Overmind rehearsal', ticker: 'RHRSL', description: 'a test coin on a local copy of mainnet', image: 'url' in img ? img.url : undefined, links: { twitter: '@overmind_test', website: 'example.com/omd' } });
    const signed = built.txs.map((b) => { const t = VersionedTransaction.deserialize(Buffer.from(b, 'base64')); t.sign([K.launcher]); return t; });
    for (const t of signed) await ensure(t);
    check('two transactions, each under the size limit', signed.length === 2 && signed.every((t) => t.serialize().length <= 1232), signed.map((t) => t.serialize().length).join('/') + ' bytes');

    // refusals first: a tampered create (different message) and a follow-up that doesn't pay the rent back
    const forged = VersionedTransaction.deserialize(Buffer.from(built.txs[0], 'base64'));
    forged.message.recentBlockhash = Keypair.generate().publicKey.toBase58(); // a different message, always
    forged.sign([K.launcher]);
    check('a tampered create is refused', (await L.countersign(built.mint, Buffer.from(forged.serialize()))) === null);
    check('a follow-up without the rent is refused', !(await L.checkFollowUp(Buffer.from(signed[0].serialize()), launcher)));
    check('a follow-up from someone else is refused', !(await L.checkFollowUp(Buffer.from(signed[1].serialize()), K.traders[0].publicKey.toBase58())));

    const create = await L.countersign(built.mint, Buffer.from(signed[0].serialize()));
    check('the server co-signs the exact create', !!create);
    check('the follow-up pays the rent back', await L.checkFollowUp(Buffer.from(signed[1].serialize()), launcher));
    const t0 = (await local.getBalance(K.treasury.publicKey));
    let lived = '';
    const r = await L.runLaunch(built.mint, create!, Buffer.from(signed[1].serialize()), async (mint) => {
      lived = mint;
      const c = await coins.coin(mint);
      await coins.setNote(mint, await coins.launchNote(c!));
      await S.snapshot(mint);
    });
    check('the launch lands and goes live', r.ok, JSON.stringify(r));
    check('the coin is live in the database, its mint key forgotten', lived === built.mint && (await pool.query(`select status, mint_secret from lp_coins where mint = $1`, [built.mint])).rows[0]?.status === 'live'
      && (await pool.query(`select mint_secret from lp_coins where mint = $1`, [built.mint])).rows[0]?.mint_secret === null);
    check('the treasury is not out of pocket', (await local.getBalance(K.treasury.publicKey)) >= t0 - 10_000, `${(((await local.getBalance(K.treasury.publicKey)) - t0) / 1e9).toFixed(6)} SOL`);

    // 4. on chain: the curve's creator is the sharing config, our treasury its admin, the split as configured
    const p = pump(), mintPk = new PublicKey(built.mint);
    const on = await L.launchOnChain(built.mint, launcher);
    check(`fee split on chain (treasury ${LP_TREASURY_BPS / 100}%, launcher ${LP_LAUNCHER_BPS / 100}%)`, on.ok, on.reason);
    const cfg = p.PUMP_SDK.decodeSharingConfig((await local.getAccountInfo(p.feeSharingConfigPda(mintPk)))!);
    check('sharing config admin is the treasury', cfg.admin.equals(K.treasury.publicKey));
    const c = await coins.coin(built.mint);
    check('the Overmind wrote a note on it', !!c?.note, c?.note ?? '');
    const meta = await coins.metadata(built.mint);
    check('token metadata served', meta?.symbol === 'RHRSL' && !!meta.image, meta?.image);
    check('its X and website are in the metadata (pump.fun shows them)', meta?.twitter === 'https://x.com/overmind_test' && meta?.website === 'https://example.com/omd', `${meta?.twitter} ${meta?.website}`);
    let refused = '';
    try { await L.buildLaunch({ wallet: launcher, name: 'Bad link', ticker: 'BADL', links: { website: 'javascript:alert(1)' } }); } catch (e) { refused = (e as Error).message; }
    check('a bad link is refused before anything is built', /website/.test(refused), refused);

    // 5. buys: the launcher's first buy, then three traders
    for (const [name, k, sol] of [['launcher', K.launcher, 1], ['trader-1', K.traders[0], 0.5], ['trader-2', K.traders[1], 0.25], ['trader-3', K.traders[2], 2]] as const) {
      const b = await L.buildBuy(k.publicKey.toBase58(), built.mint, sol);
      const tx = VersionedTransaction.deserialize(Buffer.from(b.txs[0], 'base64'));
      tx.sign([k]);
      await ensure(tx);
      const sent = await L.submitBuy(Buffer.from(tx.serialize()));
      check(`${name} buys ${sol} SOL`, sent.ok, sent.error ?? `${b.tokens} tokens quoted`);
    }
    // creator fees from those buys: distributed to the treasury and the launcher, in the split
    const { distributeFees } = await import('../src/lp/fees.js');
    const [tBefore, lBefore] = await Promise.all([local.getBalance(K.treasury.publicKey), local.getBalance(K.launcher.publicKey)]);
    const paid = await distributeFees();
    const [tAfter, lAfter] = await Promise.all([local.getBalance(K.treasury.publicKey), local.getBalance(K.launcher.publicKey)]);
    check('creator fees distributed to the treasury and the launcher', paid >= 1 && lAfter > lBefore, `launcher +${((lAfter - lBefore) / 1e9).toFixed(6)} SOL, treasury ${((tAfter - tBefore) / 1e9).toFixed(6)} SOL (net of the fee it paid)`);
    const replay = await L.submitBuy(Buffer.from(VersionedTransaction.deserialize(Buffer.from((await L.buildBuy(launcher, built.mint, 0.1)).txs[0], 'base64')).serialize()));
    check('an unsigned buy is refused', !replay.ok);

    // 6. a holder snapshot: four wallets, its record re-hashes to its fingerprint, sealed as a memo
    const snap = await S.snapshot(built.mint);
    check('snapshot finds the four holders', snap.holders === 4, `${snap.holders} holders`);
    const rec = await S.snapshotRecord(built.mint, snap.n);
    check('the record re-hashes to the fingerprint', !!rec && sha256(rec.record) === rec.fingerprint && rec.fingerprint === snap.fingerprint, snap.fingerprint.slice(0, 16));
    const holders = (JSON.parse(rec!.record) as { holders: [string, string][] }).holders.map(([w]) => w);
    check('the launcher and the traders are in it', [K.launcher, ...K.traders].every((k) => holders.includes(k.publicKey.toBase58())));
    const sealed = await S.sealPending();
    check('snapshots sealed on chain', sealed >= 2, `${sealed} memos`);
    const memo = (await pool.query(`select memo_tx from lp_snapshots where mint = $1 and n = $2`, [built.mint, snap.n])).rows[0]?.memo_tx as string | undefined;
    const logs = memo ? (await local.getTransaction(memo, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }))?.meta?.logMessages ?? [] : [];
    check('the memo carries the fingerprint', logs.some((l) => l.includes(`sha256:${snap.fingerprint}`)), memo);
    const list = await coins.liveCoins();
    check('the coin is on the wall list', list.some((x) => x.mint === built.mint && x.snapshots === 2 && x.holders === 4));

    writeFileSync(`${DIR}results.json`, JSON.stringify({ mint: built.mint, results }, null, 1));
    if (HOLD && results.every((x) => x.ok)) {
      // six more coins for the wall, each with a picture, bought into by the traders; a funded wallet for the site
      const sharp = (await import('sharp')).default;
      const coinsToMake = [['Floppy Moon', 'FMOON', '#2b64cc', '☾'], ['Lamport', 'LMPRT', '#d8322c', 'L'], ['Q-Day Club', 'QDAY', '#f3c331', 'Q'],
        ['Beige Box', 'BEIGE', '#ef7b1f', '▣'], ['Readme', 'README', '#3aa857', '?'], ['Static', 'STATIC', '#7b44b8', '≋']] as const;
      for (const [name, ticker, colour, glyph] of coinsToMake) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${colour}"/><text x="256" y="330" font-size="260" text-anchor="middle" fill="#fff" font-family="Helvetica">${glyph}</text></svg>`;
        const up = await coins.saveImage(await sharp(Buffer.from(svg)).png().toBuffer(), 'image/png', 'rehearsal');
        const b = await L.buildLaunch({ wallet: launcher, name, ticker, description: `${name.toLowerCase()}: a test coin on a local copy of mainnet`, image: 'url' in up ? up.url : undefined });
        const s = b.txs.map((x) => { const t = VersionedTransaction.deserialize(Buffer.from(x, 'base64')); t.sign([K.launcher]); return t; });
        const cs = await L.countersign(b.mint, Buffer.from(s[0].serialize()));
        const rr = await L.runLaunch(b.mint, cs!, Buffer.from(s[1].serialize()), async (mint) => { const c = await coins.coin(mint); await coins.setNote(mint, await coins.launchNote(c!)); });
        for (const k of K.traders.slice(0, 1 + (ticker.length % 3))) {
          const bb = await L.buildBuy(k.publicKey.toBase58(), b.mint, 0.3);
          const tx = VersionedTransaction.deserialize(Buffer.from(bb.txs[0], 'base64')); tx.sign([k]);
          await L.submitBuy(Buffer.from(tx.serialize()));
        }
        await S.snapshot(b.mint);
        console.log(`  + $${ticker} ${rr.ok ? 'live' : 'failed'} ${b.mint}`);
      }
      await S.sealPending(20);
      for (const k of [K.ui, ...K.uiWallets]) await airdrop(k.publicKey, 20);
      console.log(`  + ui wallets funded: ${[K.ui, ...K.uiWallets].map((k) => k.publicKey.toBase58().slice(0, 6)).join(', ')}`);
    }
    await pool.end();
    process.exit(results.every((x) => x.ok) ? 0 : 1);
  } catch (e) {
    await pool.end().catch(() => {});
    if (e instanceof NeedClone) process.exit(3);
    console.error(e);
    process.exit(1);
  }
}

if (process.argv.includes('--child')) await child(); else await parent();

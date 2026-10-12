/**
 * Solana wallets, through the Wallet Standard (Phantom, Solflare, Backpack and any wallet that registers): no wallet
 * library, no accounts. A phone browser has no wallet in it, so there the visitor is offered to open this page inside
 * their wallet's own browser.
 */
type Account = { address: string; publicKey: Uint8Array; chains: readonly string[] };
interface StdWallet {
  name: string; icon: string; chains: readonly string[]; accounts: readonly Account[];
  features: Record<string, unknown> & {
    'standard:connect'?: { connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly Account[] }> };
    'standard:disconnect'?: { disconnect: () => Promise<void> };
    'solana:signTransaction'?: { signTransaction: (...inputs: { account: Account; transaction: Uint8Array; chain?: string }[]) => Promise<{ signedTransaction: Uint8Array }[]> };
  };
}

const found: StdWallet[] = [];
const listeners = new Set<() => void>();
const api = { register: (...ws: StdWallet[]) => { for (const w of ws) if (!found.includes(w)) found.push(w); listeners.forEach((f) => f()); return () => {}; } };
window.addEventListener('wallet-standard:register-wallet', ((e: CustomEvent<(a: typeof api) => void>) => e.detail(api)) as EventListener);
window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));

/** While previewing, only the preview wallet is offered (a real wallet would be asked to sign what isn't real). */
export const walletRules: { only?: string } = {};
/** Installed Solana wallets that can sign transactions. */
export const wallets = () => found.filter((w) => w.features['standard:connect'] && w.features['solana:signTransaction'] && w.chains.some((c) => c.startsWith('solana:'))
  && (!walletRules.only || w.name === walletRules.only));
export const onWallets = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export interface Connected { wallet: StdWallet; account: Account; address: string; name: string; icon: string }
export async function connect(w: StdWallet): Promise<Connected> {
  const r = await w.features['standard:connect']!.connect();
  const account = r.accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? r.accounts[0] ?? w.accounts[0];
  if (!account) throw new Error(`${w.name} didn't share an account.`);
  return { wallet: w, account, address: account.address, name: w.name, icon: w.icon };
}
/** The wallet a visitor connected, shared by every panel (the launchpad, the lifeboat). */
export const session: { wallet?: Connected } = {};

/** Signs every transaction in one wallet prompt, in order (the lifeboat signs on the test network: chain solana:devnet). */
export async function signAll(c: Connected, txs: Uint8Array[], chain = 'solana:mainnet'): Promise<Uint8Array[]> {
  const out = await c.wallet.features['solana:signTransaction']!.signTransaction(...txs.map((transaction) => ({ account: c.account, transaction, chain })));
  return out.map((o) => o.signedTransaction);
}

/** On a phone with no wallet in the browser: open this page inside a wallet's own browser. */
export function walletBrowserLinks(url = window.location.href) {
  const u = encodeURIComponent(url), ref = encodeURIComponent(window.location.origin);
  return [
    { name: 'Phantom', href: `https://phantom.app/ul/browse/${u}?ref=${ref}` },
    { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${u}?ref=${ref}` },
    { name: 'Backpack', href: `https://backpack.app/ul/v1/browse/${u}?ref=${ref}` },
  ];
}
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

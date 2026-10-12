/**
 * Which Solana RPC each server-side part reads and writes through. With HELIUS_API_KEY set, everything uses Helius
 * (it also answers DAS, which the holder snapshots need, and isn't rate-limited like the public endpoint); without it,
 * the public endpoint. An explicit URL (SOLANA_RPC_URL, LP_RPC_URL, BOOKS_RPC_URL) still wins, so the rehearsal's fork
 * keeps working. The key stays on the server: browsers read the public RPC themselves.
 */
const PUBLIC: Record<string, string> = { 'mainnet-beta': 'https://api.mainnet-beta.solana.com', devnet: 'https://api.devnet.solana.com', testnet: 'https://api.testnet.solana.com' };
const KEY = process.env.HELIUS_API_KEY?.trim();

/** Helius for a cluster (mainnet-beta or devnet), when there's a key. */
export const helius = (cluster: string) => (KEY && (cluster === 'mainnet-beta' || cluster === 'devnet')
  ? `https://${cluster === 'mainnet-beta' ? 'mainnet' : 'devnet'}.helius-rpc.com/?api-key=${encodeURIComponent(KEY)}` : undefined);
/** The RPC for a cluster: an explicit URL, else Helius, else the public endpoint. */
export const rpcFor = (cluster: string, explicit?: string) => explicit || helius(cluster) || PUBLIC[cluster] || PUBLIC['mainnet-beta'];
/** Mainnet, for the parts that only ever read mainnet (the watch, the Solana source, the books, the launchpad). */
export const MAINNET_RPC = rpcFor('mainnet-beta', process.env.MAINNET_RPC_URL);
/** What /health says about an RPC (never the URL: it carries the key). */
export const rpcKind = (url: string) => (url.includes('helius-rpc.com') ? 'helius' : Object.values(PUBLIC).includes(url) ? 'public' : 'custom');

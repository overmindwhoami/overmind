/**
 * The launchpad's client: the live service's /api/lp routes (server/src/lp/routes.ts). Nothing here signs anything;
 * transactions come back unsigned for the visitor's own wallet (src/ui/wallet.ts).
 */
export interface LpSnapshot { n: number; at: number; slot: number; holders: number; held: string; fingerprint: string; tx: string | null }
export interface LpCoin {
  mint: string; name: string; ticker: string; description: string | null; image: string | null; launcher: string; note: string | null;
  liveAt: number; snapshots: number; holders: number | null; lastSnapshotAt: number | null; sig: string | null; pump: string;
  links?: { website?: string; twitter?: string }; page?: string;
  snapshotList?: LpSnapshot[];
}
export interface LpStatus { open: boolean; treasury: string; split: { treasury: number; launcher: number }; snapshotHours: number; costSol: number }
export interface Sent { ok: boolean; sig?: string; pending?: boolean; expired?: boolean; reason?: string; error?: string }

export class Launchpad {
  constructor(readonly base: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${this.base}/api/lp/${path}`, init);
    const body = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(body.error ?? `Something went wrong (${r.status}).`);
    return body;
  }
  private post<T>(path: string, body: unknown) { return this.call<T>(path, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) }); }

  status() { return this.call<LpStatus>('status'); }
  coins() { return this.call<LpCoin[]>('coins'); }
  coin(mint: string) { return this.call<LpCoin>(`coins/${mint}`); }
  /** The exact text a snapshot's fingerprint is the SHA-256 of. */
  async record(mint: string, n: number) { const r = await fetch(`${this.base}/api/lp/coins/${mint}/snapshots/${n}/record`); if (!r.ok) throw new Error(String(r.status)); return r.text(); }
  upload(image: Blob) { return this.call<{ id: string; url: string }>('media', { method: 'POST', headers: { 'content-type': image.type }, body: image }); }
  launch(input: { wallet: string; name: string; ticker: string; description?: string; image?: string; links?: { website?: string; twitter?: string } }) { return this.post<{ mint: string; txs: string[] }>('launch', input); }
  submit(mint: string, signed: string[]) { return this.post<Sent>('launch/submit', { mint, signed }); }
  confirm(mint: string, sig: string) { return this.post<Sent>('launch/confirm', { mint, sig }); }
  buy(wallet: string, mint: string, sol: number) { return this.post<{ txs: string[]; tokens: string }>('buy', { wallet, mint, sol }); }
  submitBuy(signed: string[]) { return this.post<Sent>('buy/submit', { signed }); }
}

export const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const bytesToB64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s); };

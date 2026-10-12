/**
 * A lifeboat ticket: the Winternitz key that opens one vault, as text (TICKET.TXT) on a floppy image. Made in the
 * browser; it never leaves it unless the visitor saves it. Loading reads the key back out of the .img or the .txt.
 */
import { floppy } from './floppy';
import { hex, publicKey, rootOf, SIGNATURE_LENGTH, unhex } from './wots';

export interface Ticket { key: Uint8Array; root: Uint8Array; made: string }
export const ticketOf = (key: Uint8Array, made = new Date().toISOString()): Ticket => ({ key, root: rootOf(publicKey(key)), made });

export function ticketText(t: Ticket, vault: string, program: string, network: string): string {
  const lines = hex(t.key).match(/.{1,64}/g)!.join('\n');
  return [
    'OVERMIND LIFEBOAT TICKET', '',
    `network  ${network}${network === 'mainnet' ? '' : ' (a test network: not real money)'}`,
    `vault    ${vault}`, `program  ${program}`, `made     ${t.made}`, '',
    'This is a Winternitz key: a hash-based signature quantum computers',
    "can't forge. Only it can open the vault above.",
    '', 'KEEP IT SECRET. ANYONE WITH THIS KEY CAN EMPTY THE VAULT.',
    'IT SIGNS ONCE: TAKING SOL OUT MOVES THE REST TO A NEW TICKET.', '',
    `key (${SIGNATURE_LENGTH} bytes, hex):`, lines, '', 'overmind.im', '',
  ].join('\n');
}

export function ticketImage(t: Ticket, vault: string, program: string, network: string): Blob {
  const img = floppy('LIFEBOAT', [{ name: 'TICKET', ext: 'TXT', text: ticketText(t, vault, program, network) }], new Date(t.made));
  return new Blob([img as BlobPart], { type: 'application/octet-stream' });
}

/** Reads a ticket from a saved .img or .txt (the key's hex lines follow "key (… bytes, hex):"). */
export function readTicket(bytes: Uint8Array): Ticket {
  const text = new TextDecoder('latin1').decode(bytes);
  const at = text.indexOf('OVERMIND LIFEBOAT TICKET');
  if (at < 0) throw new Error("that isn't a lifeboat ticket.");
  const m = text.slice(at).match(/key \(\d+ bytes, hex\):\s*([0-9a-f\s]+)/i);
  const key = m ? unhex(m[1].replace(/\s+/g, '')) : new Uint8Array();
  if (key.length !== SIGNATURE_LENGTH) throw new Error('the key on that ticket is damaged.');
  const made = text.slice(at).match(/made\s+(\S+)/)?.[1] ?? new Date().toISOString();
  return ticketOf(key, made);
}

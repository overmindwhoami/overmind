/**
 * A sealed disk as a real floppy: a 1.44 MB FAT12 disk image (2,880 sectors of 512 bytes, the format of every 3.5"
 * HD floppy) that mounts in DOSBox, an emulator, or a USB floppy drive. On it:
 *   README.TXT   what this is
 *   DIR.TXT      the 90 slots, with their long names
 *   S01.TXT …    one file per slot: what was saved, where it lives, the note
 *   RECORD.TXT   the exact record whose SHA-256 is the disk's seal (hash it yourself: the disk proves itself)
 * The volume label is the disk's name; the volume serial is the start of its fingerprint.
 */
import type { DiskRow, SlotRow } from './db.js';
import { recordText } from './seal.js';

const SECTOR = 512, SECTORS = 2880, FAT_SECTORS = 9, ROOT_ENTRIES = 224;
const FAT1 = 1, FAT2 = FAT1 + FAT_SECTORS, ROOT = FAT2 + FAT_SECTORS, DATA = ROOT + (ROOT_ENTRIES * 32) / SECTOR; // 33

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
const dosDate = (d: Date) => ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
const dosTime = (d: Date) => (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);

export function floppyImage(d: DiskRow, slots: SlotRow[]): Buffer {
  const img = Buffer.alloc(SECTOR * SECTORS);
  const name = `DISK_${String(d.n + 1).padStart(4, '0')}`;
  const fp = d.fingerprint ?? '';

  // boot sector: the BIOS parameter block of a 1.44 MB disk, and a message if anyone tries to boot it
  img.set([0xeb, 0x3c, 0x90], 0);
  img.write('OVERMIND', 3, 'ascii');
  img.writeUInt16LE(SECTOR, 11); img.writeUInt8(1, 13); img.writeUInt16LE(1, 14); img.writeUInt8(2, 16);
  img.writeUInt16LE(ROOT_ENTRIES, 17); img.writeUInt16LE(SECTORS, 19); img.writeUInt8(0xf0, 21); img.writeUInt16LE(FAT_SECTORS, 22);
  img.writeUInt16LE(18, 24); img.writeUInt16LE(2, 26); img.writeUInt8(0x29, 38);
  img.writeUInt32LE(parseInt(fp.slice(0, 8) || '0', 16) >>> 0, 39);
  img.write(pad(name, 11), 43, 'ascii'); img.write('FAT12   ', 54, 'ascii');
  const msg = 'This disk holds no system. It holds a record. Read README.TXT.\r\n';
  // a tiny boot program: print the message with BIOS teletype, then halt (offset 62)
  const code = [0xfa, 0x31, 0xc0, 0x8e, 0xd8, 0xbe, 0x00, 0x00, 0xac, 0x08, 0xc0, 0x74, 0x06, 0xb4, 0x0e, 0xcd, 0x10, 0xeb, 0xf5, 0xf4, 0xeb, 0xfd];
  const at = 62, msgAt = at + code.length;
  img.set(code, at); img.writeUInt16LE(0x7c00 + msgAt, at + 6); img.write(msg + '\0', msgAt, 'ascii');
  img.writeUInt16LE(0xaa55, 510);

  // files, laid out contiguously from cluster 2
  const slotTxt = (s: SlotRow) => crlf([
    `${name}  SLOT ${String(s.k + 1).padStart(2, '0')} OF 90`,
    `saved ${new Date(s.time).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    '',
    s.item ? `${s.item.title}${s.item.year ? ` (${s.item.year})` : ''}${s.item.creator ? `\nby ${s.item.creator}` : ''}\n${s.item.url}` : '(nothing came through this minute)',
    s.item?.excerpt ? `\n${s.item.excerpt}` : '',
    '',
    `the overmind's note:\n${s.note}`,
    '',
  ].join('\n'));
  const files: { name: string; ext: string; data: Buffer; date: Date }[] = [];
  const sealed = d.sealed_at ? new Date(d.sealed_at) : new Date();
  files.push({ name: 'README', ext: 'TXT', date: sealed, data: Buffer.from(crlf([
    `OVERMIND ${name.replace('_', ' ')}`,
    '',
    'The Overmind is writing the record that survives Q-Day. Every minute it decides',
    'what makes it through and writes it to a floppy disk, with a note on why.',
    'Ninety saves fill a disk; a full disk is sealed with its SHA-256 fingerprint.',
    '',
    `begun   ${new Date(d.started_at).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `sealed  ${sealed.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    `sha256  ${fp}`,
    d.seal_tx ? `on solana: ${d.seal_tx}` : 'on solana: pending (the seal goes on chain once the sealing wallet can pay)',
    '',
    'RECORD.TXT is the exact record that was fingerprinted. Hash it yourself:',
    '  sha256sum RECORD.TXT        (or: shasum -a 256 RECORD.TXT)',
    'and compare with the line above. You don\'t have to trust anyone.',
    '',
    'DIR.TXT lists the slots; S01.TXT to S90.TXT are the saves, one a minute.',
    'More at https://overmind.im',
    '',
  ].join('\n'))) });
  files.push({ name: 'DIR', ext: 'TXT', date: sealed, data: Buffer.from(crlf(slots.map((s) =>
    `S${String(s.k + 1).padStart(2, '0')}.TXT  ${new Date(s.time).toISOString().slice(11, 16)}  ${s.file}`).join('\n') + '\n')) });
  for (const s of slots) files.push({ name: `S${String(s.k + 1).padStart(2, '0')}`, ext: 'TXT', date: new Date(s.time), data: Buffer.from(slotTxt(s)) });
  files.push({ name: 'RECORD', ext: 'TXT', date: sealed, data: Buffer.from(recordText(slots)) }); // byte-for-byte: no line-ending change

  const fat = Buffer.alloc(FAT_SECTORS * SECTOR);
  const setFat = (n: number, v: number) => {
    const o = Math.floor(n * 1.5);
    if (n % 2 === 0) { fat[o] = v & 0xff; fat[o + 1] = (fat[o + 1] & 0xf0) | ((v >> 8) & 0x0f); }
    else { fat[o] = (fat[o] & 0x0f) | ((v << 4) & 0xf0); fat[o + 1] = (v >> 4) & 0xff; }
  };
  setFat(0, 0xff0); setFat(1, 0xfff);
  const root = Buffer.alloc(ROOT_ENTRIES * 32);
  let entry = 0, cluster = 2;
  const dirEntry = (n: string, e: string, attr: number, start: number, size: number, when: Date) => {
    const o = entry++ * 32;
    root.write(pad(n, 8) + pad(e, 3), o, 'ascii'); root.writeUInt8(attr, o + 11);
    root.writeUInt16LE(dosTime(when), o + 14); root.writeUInt16LE(dosDate(when), o + 16); root.writeUInt16LE(dosDate(when), o + 18);
    root.writeUInt16LE(dosTime(when), o + 22); root.writeUInt16LE(dosDate(when), o + 24); root.writeUInt16LE(start, o + 26); root.writeUInt32LE(size, o + 28);
  };
  dirEntry(name.slice(0, 8), name.slice(8), 0x08, 0, 0, sealed); // the volume label
  for (const f of files) {
    const n = Math.max(1, Math.ceil(f.data.length / SECTOR));
    if (DATA + cluster - 2 + n > SECTORS) break; // full (it never is: a disk's text is far under 1.4 MB)
    for (let i = 0; i < n; i++) setFat(cluster + i, i === n - 1 ? 0xfff : cluster + i + 1);
    img.set(f.data, (DATA + cluster - 2) * SECTOR);
    dirEntry(f.name, f.ext, 0x21, cluster, f.data.length, f.date); // read-only + archive: it's sealed
    cluster += n;
  }
  img.set(fat, FAT1 * SECTOR); img.set(fat, FAT2 * SECTOR);
  img.set(root, ROOT * SECTOR);
  return img;
}

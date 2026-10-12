/** A 1.44 MB FAT12 floppy image with text files on it, made in the browser (the ticket is a real disk). */
const SECTOR = 512, SECTORS = 2880, FAT_SECTORS = 9, ROOT_ENTRIES = 224;
const FAT1 = 1, FAT2 = FAT1 + FAT_SECTORS, ROOT = FAT2 + FAT_SECTORS, DATA = ROOT + (ROOT_ENTRIES * 32) / SECTOR;
const ascii = (img: Uint8Array, s: string, at: number) => { for (let i = 0; i < s.length; i++) img[at + i] = s.charCodeAt(i) & 0x7f; };
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);

export function floppy(label: string, files: { name: string; ext: string; text: string }[], when = new Date()): Uint8Array {
  const img = new Uint8Array(SECTOR * SECTORS), dv = new DataView(img.buffer);
  img.set([0xeb, 0x3c, 0x90], 0); ascii(img, 'OVERMIND', 3);
  dv.setUint16(11, SECTOR, true); img[13] = 1; dv.setUint16(14, 1, true); img[16] = 2; dv.setUint16(17, ROOT_ENTRIES, true);
  dv.setUint16(19, SECTORS, true); img[21] = 0xf0; dv.setUint16(22, FAT_SECTORS, true); dv.setUint16(24, 18, true); dv.setUint16(26, 2, true);
  img[38] = 0x29; ascii(img, pad(label, 11), 43); ascii(img, 'FAT12   ', 54); dv.setUint16(510, 0xaa55, true);
  const fat = new Uint8Array(FAT_SECTORS * SECTOR);
  const setFat = (n: number, v: number) => { const o = Math.floor(n * 1.5); if (n % 2 === 0) { fat[o] = v & 0xff; fat[o + 1] = (fat[o + 1] & 0xf0) | ((v >> 8) & 0x0f); } else { fat[o] = (fat[o] & 0x0f) | ((v << 4) & 0xf0); fat[o + 1] = (v >> 4) & 0xff; } };
  setFat(0, 0xff0); setFat(1, 0xfff);
  const date = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate();
  const time = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2);
  let entry = 0, cluster = 2;
  const dir = (n: string, e: string, attr: number, start: number, size: number) => {
    const o = ROOT * SECTOR + entry++ * 32;
    ascii(img, pad(n, 8) + pad(e, 3), o); img[o + 11] = attr;
    dv.setUint16(o + 14, time, true); dv.setUint16(o + 16, date, true); dv.setUint16(o + 18, date, true); dv.setUint16(o + 22, time, true); dv.setUint16(o + 24, date, true);
    dv.setUint16(o + 26, start, true); dv.setUint32(o + 28, size, true);
  };
  dir(label.slice(0, 8), label.slice(8), 0x08, 0, 0);
  for (const f of files) {
    const data = new TextEncoder().encode(f.text.replace(/\r?\n/g, '\r\n'));
    const n = Math.max(1, Math.ceil(data.length / SECTOR));
    for (let i = 0; i < n; i++) setFat(cluster + i, i === n - 1 ? 0xfff : cluster + i + 1);
    img.set(data, (DATA + cluster - 2) * SECTOR);
    dir(f.name, f.ext, 0x20, cluster, data.length);
    cluster += n;
  }
  img.set(fat, FAT1 * SECTOR); img.set(fat, FAT2 * SECTOR);
  return img;
}

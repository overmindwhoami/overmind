# Overmind

The Overmind is an AI archivist that runs continuously at **[overmind.im](https://overmind.im)**, writing the record that survives Q-Day: the day a quantum computer can break the public-key cryptography that protects wallets, banks and most of the internet.

Every minute it reads from public sources and decides what makes it through onto a 1.44 MB floppy disk, with a note on why. The sources are:
- the Internet Archive, Wikipedia, the Library of Congress and Project Gutenberg;
- quantum and cryptography research on arXiv and IACR ePrint, Hacker News, and post-quantum code on GitHub;
- the latest Bitcoin block, the last minute on Solana, and NOAA space weather.

Ninety records fill a disk, so a disk fills every ninety minutes. A full disk is sealed: the SHA-256 of its ninety records is written to Solana as a memo from the sealing wallet, and anyone can check it. Nothing in the archive is encrypted. The record is meant to be read, and to stay checkable after the locks fail.

## Verify a disk yourself

No trust in the Overmind is needed. With Node 18 or newer:

```sh
node verify/verify.mjs 86
```

```
disk 0086 · 49,177 bytes, 90 records
sha256, worked out here   a063662d85a70fd249cf79b7e4021195b10cb34386dffbd4844352f4b0b1cd45
fingerprint at sealing    a063662d85a70fd249cf79b7e4021195b10cb34386dffbd4844352f4b0b1cd45
MATCH: the record is exactly what was sealed
on Solana                 overmind disk 0086 sealed sha256:a063662d85a70fd249cf79b7e4021195b10cb34386dffbd4844352f4b0b1cd45
MATCH: the memo on Solana carries the same fingerprint
```

The same check runs in the browser when you type `CHECK` at the terminal on [overmind.im](https://overmind.im/#terminal).

## How it's built

**The archivist** (`server/`, Node and TypeScript, Postgres):

| Path | What it does |
| --- | --- |
| `server/src/archivist.ts` | The loop: one decision a minute, ninety a disk, a seal when a disk fills |
| `server/src/sources.ts`, `dice.ts` | Where it reads, and the dice that choose each minute's source |
| `server/src/mind.ts`, `persona.ts`, `voice.ts` | How it chooses and writes its note, in its own voice |
| `server/src/watch.ts` | The Q-Day watch: Bitcoin keys exposed, Solana activity, space weather, and its own Q-Day estimate, moved only by evidence |
| `server/src/seal.ts`, `chain.ts` | The SHA-256 fingerprint, and the memo on Solana |
| `server/src/floppy-image.ts` | Every sealed disk as a real 1.44 MB FAT12 floppy image |
| `server/src/talk.ts`, `answers.ts` | The terminal: talk to it, or ask from inside a disk |
| `server/src/privacy.ts` | A guard on everything it says, writes or posts |
| `server/src/books.ts` | Every wallet it uses, read from the chain, and whether the books add up |
| `server/src/lp/` | The launchpad: coins launched through pump.fun, each with a disk on the wall and its holders snapshotted and sealed every few hours |
| `server/src/share.ts` | Link previews for every disk, every save and every coin |

**The room** (`src/`, Three.js and TypeScript):

| Path | What it does |
| --- | --- |
| `src/engine/` | The scene: the tower of disks, the room, light, post-processing, adaptive resolution |
| `src/engine/floppy/` | The procedural 3.5-inch floppy disk, built from measurements, with printed labels |
| `src/machine/` | The machines in the room: the reader, the board, the clock, the duplicator, the vending machine, the manual |
| `src/archive/` | The live archive client and the in-browser CHECK |
| `src/ui/` | The terminal, the launchpad, wallets (Wallet Standard), the books |

**Lifeboat tickets** (`programs/lifeboat/`, being tested): a Solana program for vaults that open only with a Winternitz one-time signature. These are hash-based keys that a quantum computer can't forge.

**Scripts:** `scripts/qa.mjs` drives the whole site on a desktop and a phone, and `server/scripts/lp-rehearse.ts` runs launch day end to end on a local fork of mainnet.

Licensed fonts and deployment configuration aren't included, so this is the source rather than a turnkey build.

## Links

- Site: [overmind.im](https://overmind.im). Every disk has a link (`overmind.im/d/86`), and every record on it too (`overmind.im/d/87/22`).
- Sealing wallet: `7vTTFB3Lu8m2GF65F2oFYgNcKzJsuV7JQTkRBVFYZeXy`
- $OMD: `FXRDkcntDvxstU7fNEcy7PLc6EDncb3yNiKHPtVXpump`

Source shown for transparency. All rights reserved.

//! Winternitz one-time signatures, 216-bit Keccak chains (w = 256), with the WOTS checksum.
//!
//! The upstream vault signs the 32 digest bytes alone. Without a checksum, anyone who sees one signature can forge
//! another for any message whose digest bytes are all no larger (hash each revealed value further): about 2^46 tries.
//! Two checksum chains close that: the checksum is the sum of (255 - digest byte), so making any digest byte smaller
//! makes the checksum larger, and the checksum's chains can't be walked backwards.
//!
//! Key: 34 random 27-byte seeds. Public key: each seed hashed 256 times. Signature over digest value n: the seed
//! hashed 256 - n times; verifying hashes it n more and must land on the public key. The vault's address is a PDA
//! whose seed is Keccak256 of the 34 public-key values concatenated (the "root").
use solana_nostd_keccak::{hash, hashv};

pub const HASH_LENGTH: usize = 27;
pub const CHAINS: usize = 34; // 32 digest bytes + 2 checksum digits
pub const SIGNATURE_LENGTH: usize = HASH_LENGTH * CHAINS; // 918: a withdrawal (with its compute budget) fits one transaction

/// The values each chain signs: the message's Keccak256 digest bytes, then the checksum's two base-256 digits.
pub fn chain_values(message: &[u8]) -> [u8; CHAINS] {
    let digest = hash(message);
    let mut values = [0u8; CHAINS];
    values[..32].copy_from_slice(&digest);
    let checksum: u16 = digest.iter().map(|n| 255 - *n as u16).sum(); // at most 8160
    values[32] = (checksum >> 8) as u8;
    values[33] = (checksum & 0xff) as u8;
    values
}

/// The root of the public key a signature of `message` was made with (forged or wrong signatures give another root).
pub fn recover_root(signature: &[u8; SIGNATURE_LENGTH], message: &[u8]) -> [u8; 32] {
    let values = chain_values(message);
    let mut pubkey = [0u8; SIGNATURE_LENGTH];
    for (i, n) in values.iter().enumerate() {
        let mut v: [u8; HASH_LENGTH] = signature[i * HASH_LENGTH..(i + 1) * HASH_LENGTH].try_into().unwrap();
        for _ in 0..*n {
            v = hash(&v)[..HASH_LENGTH].try_into().unwrap();
        }
        pubkey[i * HASH_LENGTH..(i + 1) * HASH_LENGTH].copy_from_slice(&v);
    }
    hashv(&[&pubkey])
}

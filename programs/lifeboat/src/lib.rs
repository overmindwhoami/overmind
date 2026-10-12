//! The Overmind's lifeboat tickets: a lamports vault only a Winternitz signature can open.
//! Fork of Dean Little's solana-winternitz-vault (MIT, see LICENSE.upstream), with the WOTS checksum (src/wots.rs) and
//! every signed message bound to the vault it opens. Unaudited: test networks only.
//!
//!   0 OpenVault  [root 32][bump 1]                accounts: payer (signer, writable), vault (writable), system program
//!   1 SplitVault [signature 918][amount 8][bump 1] accounts: vault, split, refund (all writable)
//!                signs amount (u64 LE) | split | refund | vault: `amount` to split, the rest to refund, vault closed
//!   2 CloseVault [signature 918][bump 1]          accounts: vault, refund (writable)
//!                signs refund | vault: everything to refund, vault closed
//! The vault is the PDA of [root, bump] under this program. A key signs once: the remainder of a split should go to
//! a fresh vault (a new ticket).
#![no_std]
pub mod instructions;
pub mod wots;
use instructions::*;

use pinocchio::{account_info::AccountInfo, entrypoint, program_error::ProgramError, pubkey::Pubkey, ProgramResult};

/// DwqEU77NsHMtLvkLVLhYKmLCC477edS1ftbfywYre4qo
pub const ID: Pubkey = [0xc0, 0x58, 0x24, 0xa3, 0xbd, 0xb6, 0x18, 0x8e, 0xfe, 0xee, 0xd3, 0x00, 0x33, 0xfa, 0xf8, 0x2e, 0x48, 0x6d, 0x6b, 0x48, 0xe0, 0xd8, 0x6e, 0xee, 0xa3, 0x3a, 0x85, 0x3e, 0x9b, 0x1e, 0x2c, 0x32];

entrypoint!(process_instruction);

fn process_instruction(_program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let (discriminator, data) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match discriminator {
        0 => OpenVault::deserialize(data)?.process(accounts),
        1 => SplitVault::deserialize(data)?.process(accounts),
        2 => CloseVault::deserialize(data)?.process(accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// The vault's address must be the PDA of [root, bump] under this program.
pub fn check_vault(root: &[u8; 32], bump: &[u8; 1], vault: &Pubkey) -> ProgramResult {
    if solana_nostd_sha256::hashv(&[root.as_ref(), bump.as_ref(), ID.as_ref(), b"ProgramDerivedAddress"]).ne(vault) {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

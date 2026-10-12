use arrayref::array_refs;
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};

use crate::wots::{recover_root, SIGNATURE_LENGTH};

pub struct SplitVault {
    signature: [u8; SIGNATURE_LENGTH],
    amount: u64,
    bump: [u8; 1],
}

impl SplitVault {
    pub fn deserialize(bytes: &[u8]) -> Result<Self, ProgramError> {
        let data: [u8; SIGNATURE_LENGTH + 9] = bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
        let (signature, amount, bump) = array_refs![&data, SIGNATURE_LENGTH, 8, 1];
        Ok(Self { signature: *signature, amount: u64::from_le_bytes(*amount), bump: *bump })
    }

    pub fn process(&self, accounts: &[AccountInfo]) -> ProgramResult {
        let [vault, split, refund] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        if vault.owner() != &crate::ID || self.amount > vault.lamports() {
            return Err(ProgramError::InvalidArgument);
        }
        // amount | split | refund | vault: the signature can't be moved to other accounts, amounts or vaults
        let mut message = [0u8; 104];
        message[0..8].copy_from_slice(&self.amount.to_le_bytes());
        message[8..40].copy_from_slice(split.key());
        message[40..72].copy_from_slice(refund.key());
        message[72..104].copy_from_slice(vault.key());
        crate::check_vault(&recover_root(&self.signature, &message), &self.bump, vault.key())?;

        let rest = vault.lamports() - self.amount;
        *split.try_borrow_mut_lamports()? += self.amount;
        *refund.try_borrow_mut_lamports()? += rest;
        *vault.try_borrow_mut_lamports()? = 0;
        vault.close()
    }
}

use arrayref::array_refs;
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};

use crate::wots::{recover_root, SIGNATURE_LENGTH};

pub struct CloseVault {
    signature: [u8; SIGNATURE_LENGTH],
    bump: [u8; 1],
}

impl CloseVault {
    pub fn deserialize(bytes: &[u8]) -> Result<Self, ProgramError> {
        let data: [u8; SIGNATURE_LENGTH + 1] = bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
        let (signature, bump) = array_refs![&data, SIGNATURE_LENGTH, 1];
        Ok(Self { signature: *signature, bump: *bump })
    }

    pub fn process(&self, accounts: &[AccountInfo]) -> ProgramResult {
        let [vault, refund] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };
        if vault.owner() != &crate::ID {
            return Err(ProgramError::InvalidArgument);
        }
        // refund | vault
        let mut message = [0u8; 64];
        message[0..32].copy_from_slice(refund.key());
        message[32..64].copy_from_slice(vault.key());
        crate::check_vault(&recover_root(&self.signature, &message), &self.bump, vault.key())?;

        *refund.try_borrow_mut_lamports()? += vault.lamports();
        *vault.try_borrow_mut_lamports()? = 0;
        vault.close()
    }
}

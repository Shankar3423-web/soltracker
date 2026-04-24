'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');
const { WSOL_MINT } = require('../config/constants');

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function getAssociatedTokenAddress(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
    return PublicKey.findProgramAddressSync(
        [
            owner.toBuffer(),
            tokenProgramId.toBuffer(),
            mint.toBuffer(),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
}

async function verifyTreasuryFeeAccount() {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    const treasuryWallet = process.env.TREASURY_WALLET;

    if (!rpcUrl || !treasuryWallet) {
        console.log('[Treasury] Fee-account verification skipped: missing HELIUS_RPC_URL or TREASURY_WALLET');
        return;
    }

    try {
        const connection = new Connection(rpcUrl, 'confirmed');
        const feeAccount = getAssociatedTokenAddress(
            new PublicKey(treasuryWallet),
            new PublicKey(WSOL_MINT)
        );
        const accountInfo = await connection.getAccountInfo(feeAccount, 'confirmed');

        if (accountInfo) {
            console.log('[Treasury] WSOL fee account ready:', feeAccount.toBase58());
            return;
        }

        console.warn('[Treasury] WSOL fee account missing:', feeAccount.toBase58());
    } catch (error) {
        console.warn('[Treasury] Fee-account verification failed:', error.message);
    }
}

module.exports = {
    verifyTreasuryFeeAccount,
};

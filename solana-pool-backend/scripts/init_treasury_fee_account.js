'use strict';

require('dotenv').config();

const {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const { WSOL_MINT } = require('../src/config/constants');

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

function createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
    return new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: associatedToken, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
    });
}

function loadFeePayerKeypair() {
    const rawSecret = process.env.TREASURY_FEE_PAYER_SECRET;
    if (!rawSecret) {
        throw new Error('TREASURY_FEE_PAYER_SECRET is required and must be a JSON array of secret-key bytes.');
    }

    let secretKey;
    try {
        secretKey = Uint8Array.from(JSON.parse(rawSecret));
    } catch (error) {
        throw new Error('TREASURY_FEE_PAYER_SECRET must be valid JSON like [12,34,...].');
    }

    return Keypair.fromSecretKey(secretKey);
}

async function main() {
    const rpcUrl = process.env.HELIUS_RPC_URL;
    const treasuryWallet = process.env.TREASURY_WALLET;

    if (!rpcUrl) {
        throw new Error('HELIUS_RPC_URL is required.');
    }

    if (!treasuryWallet) {
        throw new Error('TREASURY_WALLET is required.');
    }

    const connection = new Connection(rpcUrl, 'confirmed');
    const treasuryOwner = new PublicKey(treasuryWallet);
    const feePayer = loadFeePayerKeypair();
    const feeAccount = getAssociatedTokenAddress(treasuryOwner, new PublicKey(WSOL_MINT));
    const existing = await connection.getAccountInfo(feeAccount, 'confirmed');

    if (existing) {
        console.log('[TreasuryInit] WSOL fee account already exists:', feeAccount.toBase58());
        return;
    }

    const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
            feePayer.publicKey,
            feeAccount,
            treasuryOwner,
            new PublicKey(WSOL_MINT)
        )
    );

    const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [feePayer],
        { commitment: 'confirmed' }
    );

    console.log('[TreasuryInit] WSOL fee account created:', feeAccount.toBase58());
    console.log('[TreasuryInit] Signature:', signature);
}

main().catch((error) => {
    console.error('[TreasuryInit] Failed:', error.message);
    process.exitCode = 1;
});

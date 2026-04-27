const {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const bs58 = require('bs58'); // Required to parse Phantom wallet export

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const TREASURY_WALLET = '4VPQh5E6atYbNDAtE9TKpCRVL4RBYgkNu3KDf3VqcJWe';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const WSOL_ATA = 'E4pWSEHLentftgggf2iko3GAd95pScayCQaWmwr7zvTR';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ============================================================================
// ⚠️ IMPORTANT: PASTE YOUR PHANTOM DEVNET PRIVATE KEY (BASE58) HERE
// Keep this local, do not commit to github!
// ============================================================================
const PAYER_PRIVATE_KEY_BASE58 = 'PASTE_YOUR_PHANTOM_PRIVATE_KEY_HERE';

function createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint) {
    return new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: associatedToken, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
    });
}

async function main() {
    if (PAYER_PRIVATE_KEY_BASE58 === 'PASTE_YOUR_PHANTOM_PRIVATE_KEY_HERE') {
        console.error('❌ Please paste your devnet wallet private key in the script first!');
        process.exit(1);
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const feePayer = Keypair.fromSecretKey(bs58.decode(PAYER_PRIVATE_KEY_BASE58));
    const treasuryOwner = new PublicKey(TREASURY_WALLET);
    const feeAccount = new PublicKey(WSOL_ATA);
    const wsolMint = new PublicKey(WSOL_MINT);

    console.log(`Using Payer: ${feePayer.publicKey.toBase58()}`);
    console.log(`Checking if ATA exists: ${feeAccount.toBase58()}...`);

    const existing = await connection.getAccountInfo(feeAccount, 'confirmed');
    if (existing) {
        console.log('✅ WSOL ATA already exists! No need to create it.');
        return;
    }

    console.log('Creating ATA on Devnet...');
    const transaction = new Transaction().add(
        createAssociatedTokenAccountInstruction(
            feePayer.publicKey,
            feeAccount,
            treasuryOwner,
            wsolMint
        )
    );

    try {
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [feePayer],
            { commitment: 'confirmed' }
        );
        console.log('🎉 Successfully created WSOL ATA!');
        console.log(`Transaction Signature: ${signature}`);
        console.log(`View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`);
    } catch (err) {
        console.error('❌ Failed to create ATA:', err.message);
    }
}

main().catch(console.error);

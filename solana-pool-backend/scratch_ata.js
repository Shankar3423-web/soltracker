const { PublicKey } = require("@solana/web3.js");

const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function getAssociatedTokenAddress(mint, owner) {
    const [address] = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    );
    return address;
}

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TREASURY = new PublicKey("4VPQh5E6atYbNDAtE9TKpCRVL4RBYgkNu3KDf3VqcJWe");

console.log("ATA generated:", getAssociatedTokenAddress(WSOL_MINT, TREASURY).toBase58());

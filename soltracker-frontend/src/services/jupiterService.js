const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';

/**
 * Fetch a swap quote from Jupiter.
 * @param {string} inputMint - Token user is selling (e.g. SOL)
 * @param {string} outputMint - Token user is buying
 * @param {number} amount - Amount in atomic units (e.g. lamports)
 * @param {number} slippageBps - Slippage in basis points (1% = 100)
 * @param {string} treasuryWallet - Your wallet to receive fees
 */
export async function getJupiterQuote({
    inputMint,
    outputMint,
    amount,
    slippageBps = 50,
    treasuryWallet
}) {
    // feeBps: 50 = 0.5%
    const url = `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&platformFeeBps=50`;
    
    const res = await fetch(url);
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch quote from Jupiter');
    }
    return res.json();
}

/**
 * Generate a serialized transaction for the swap.
 * @param {object} quoteResponse - The quote object from getJupiterQuote
 * @param {string} userPublicKey - The user's wallet address
 */
export async function getJupiterSwapTransaction(quoteResponse, userPublicKey, computeUnitPriceMicroLamports) {
    const res = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quoteResponse,
            userPublicKey,
            wrapAndUnwrapSol: true,
            computeUnitPriceMicroLamports: computeUnitPriceMicroLamports || 0,
        })
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to generate swap transaction');
    }
    return res.json();
}

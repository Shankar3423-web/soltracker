const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1/swap';

/**
 * Fetch a swap quote from Jupiter.
 * @param {string} inputMint - Token user is selling (e.g. SOL)
 * @param {string} outputMint - Token user is buying
 * @param {number} amount - Amount in atomic units (e.g. lamports)
 * @param {number} slippageBps - Slippage in basis points (1% = 100)
 */
export async function getJupiterQuote({
    inputMint,
    outputMint,
    amount,
    slippageBps = 50,
    restrictIntermediateTokens = true,
    platformFeeBps = 50,
}) {
    const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: String(amount),
        slippageBps: String(slippageBps),
        restrictIntermediateTokens: String(restrictIntermediateTokens),
    });

    if (Number.isFinite(Number(platformFeeBps)) && Number(platformFeeBps) > 0) {
        params.set('platformFeeBps', String(Math.max(0, Math.min(10000, Number(platformFeeBps)))));
    }

    const url = `${JUPITER_QUOTE_API}?${params.toString()}`;
    
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
export async function getJupiterSwapTransaction(
    quoteResponse,
    userPublicKey,
    computeUnitPriceMicroLamports,
    feeAccount,
    trackingAccount,
    platformFeeBps = 50
) {
    const normalizedPlatformFeeBps = Number.isFinite(Number(platformFeeBps))
        ? Math.max(0, Math.min(10000, Number(platformFeeBps)))
        : 50;

    if (normalizedPlatformFeeBps > 0 && !feeAccount) {
        throw new Error('Treasury fee account is required when platform fees are enabled.');
    }

    const requestBody = {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        computeUnitPriceMicroLamports: computeUnitPriceMicroLamports || 0,
        trackingAccount,
    };

    if (normalizedPlatformFeeBps > 0) {
        requestBody.feeAccount = feeAccount;
    }

    const res = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to generate swap transaction');
    }
    return res.json();
}

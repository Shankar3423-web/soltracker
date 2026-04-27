export const SOLANA_NETWORK = process.env.REACT_APP_SOLANA_NETWORK || 'mainnet-beta';

export const RPC_ENDPOINT = SOLANA_NETWORK === 'devnet' 
    ? "https://api.devnet.solana.com" 
    : (process.env.REACT_APP_HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com");

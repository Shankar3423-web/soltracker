import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react"
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui"
import { useMemo } from "react"

export default function SolanaWalletProvider({ children }) {
  // Use the public RPC endpoint
  const endpoint = "https://api.mainnet-beta.solana.com"

  // Only auto-connect if the user hasn't explicitly signed out recently
  const autoConnect = useMemo(() => {
    return localStorage.getItem('wallet_disconnected') !== 'true';
  }, []);

  /**
   * We pass an empty array here because modern wallets (Phantom, Solflare, Backpack)
   * now use the "Wallet Standard". The WalletProvider automatically detects 
   * these standard wallets from your browser extension.
   */
  const wallets = useMemo(() => [], [])

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={autoConnect}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

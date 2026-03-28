import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import { BASE } from '../utils/api';

export function useSolanaWallet() {
    const { publicKey, connected } = useWallet();
    const [solBalance, setSolBalance] = useState(0);
    const walletAddress = publicKey?.toString();

    useEffect(() => {
        async function fetchBalance() {
            if (!walletAddress) return;

            try {
                const connection = new Connection('https://api.mainnet-beta.solana.com');
                const balance = await connection.getBalance(new PublicKey(walletAddress));
                setSolBalance(balance / 1e9);
            } catch (err) {
                console.error('Error fetching balance:', err);
            }
        }

        async function syncWithBackend() {
            if (!walletAddress) return;

            try {
                await fetch(`${BASE}/auth/wallet`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        wallet_address: walletAddress,
                    }),
                });
            } catch (err) {
                console.error('Error syncing with backend:', err);
            }
        }

        if (connected && walletAddress) {
            localStorage.setItem('wallet_disconnected', 'false');
            fetchBalance();
            syncWithBackend();
        }
    }, [connected, walletAddress]);

    return {
        walletAddress,
        connected,
        solBalance,
    };
}

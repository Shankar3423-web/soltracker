import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import { BASE } from '../utils/api';
import { RPC_ENDPOINT } from '../config/network';

export function useSolanaWallet() {
    const { publicKey, connected } = useWallet();
    const [solBalance, setSolBalance] = useState(0);
    const [username, setUsername] = useState(null);
    const [needsUsername, setNeedsUsername] = useState(false);
    const [avatarSeed, setAvatarSeed] = useState(0);
    const walletAddress = publicKey?.toString();

    useEffect(() => {
        async function fetchBalance() {
            if (!walletAddress) return;

            try {
                const connection = new Connection(RPC_ENDPOINT);
                const balance = await connection.getBalance(new PublicKey(walletAddress));
                setSolBalance(balance / 1e9);
            } catch (err) {
                console.error('Error fetching balance:', err);
            }
        }

        async function syncWithBackend() {
            if (!walletAddress) return;

            try {
                const response = await fetch(`${BASE}/auth/wallet`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        wallet_address: walletAddress,
                    }),
                });
                
                const data = await response.json();
                if (data.success) {
                    // Fetch additional info (like username)
                    const userRes = await fetch(`${BASE}/auth/wallet/${walletAddress}`);
                    const userData = await userRes.json();
                    if (userData.username) {
                        setUsername(userData.username);
                        setNeedsUsername(false);
                    } else {
                        // New user – prompt for a username
                        setNeedsUsername(true);
                    }
                }
            } catch (err) {
                console.error('Error syncing with backend:', err);
            }
        }

        if (connected && walletAddress) {
            localStorage.setItem('wallet_disconnected', 'false');
            localStorage.setItem('wallet_address', walletAddress);
            setAvatarSeed(Math.floor(Math.random() * 100000));
            fetchBalance();
            syncWithBackend();
        } else {
            setUsername(null);
            setNeedsUsername(false);
            setAvatarSeed(0);
            setSolBalance(0);
        }
    }, [connected, walletAddress]);

    return {
        walletAddress,
        connected,
        solBalance,
        username,
        setUsername,
        needsUsername,
        setNeedsUsername,
        avatarSeed,
    };
}

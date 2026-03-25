import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import React from 'react';

export default function ConnectWallet() {
    const { wallet, connected, select } = useWallet();

    // If a wallet is selected but not connected, show a "Back" button to reset selection
    if (wallet && !connected) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%' }}>
                <WalletMultiButton />
                <button 
                    onClick={() => select(null)}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#9945ff',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        padding: '5px 10px',
                        borderRadius: '4px',
                        transition: 'opacity 0.2s'
                    }}
                >
                    ← Back to Wallet List
                </button>
            </div>
        );
    }

    return <WalletMultiButton />;
}

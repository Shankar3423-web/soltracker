import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SolanaWalletProvider from "./wallet/SolanaWalletProvider";
import '@solana/wallet-adapter-react-ui/styles.css';

// 🛑 SUPPRESS REDEFEINE ETHEREUM ERRORS (BROWSER EXTENSION NOISE)
// This is caused by Phantom and MetaMask fighting over window.ethereum.
// It is safely ignored as it doesn't affect the app's functionality.
window.addEventListener('error', (e) => {
    if (e.message && e.message.includes('Cannot redefine property: ethereum')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    }
}, true);
window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && e.reason.message && e.reason.message.indexOf('Cannot redefine property: ethereum') !== -1) {
        e.stopImmediatePropagation();
    }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <SolanaWalletProvider>
            <App />
        </SolanaWalletProvider>
    </React.StrictMode>
);
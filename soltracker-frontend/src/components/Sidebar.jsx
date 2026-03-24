import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../utils/firebase';
import './Sidebar.css';
import LoginModal from './LoginModal';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { useWallet } from '@solana/wallet-adapter-react';
import { avatarGrad } from '../utils/api';

export default function Sidebar() {
    const [showLogin, setShowLogin] = useState(false);
    const [user, setUser] = useState(null);
    const { walletAddress, connected, solBalance } = useSolanaWallet();
    const { disconnect } = useWallet();

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    const handleWalletSignOut = async () => {
        try {
            localStorage.setItem('wallet_disconnected', 'true');
            await disconnect();
            // Optional: window.location.reload(); // Uncomment if you want a full state reset
        } catch (error) {
            console.error('Error disconnecting wallet:', error);
        }
    };

    return (
        <aside className="sidebar">
            <div className="sb-logo">
                <Logo />
                <span className="sb-logo-text">SolTracker</span>
            </div>
            <nav className="sb-nav">
                <div className="sb-section">NETWORK</div>
                <div className="sb-item active">
                    <SolIcon />
                    <span>Solana</span>
                    <span className="sb-live">LIVE</span>
                </div>
                <div className="sb-section" style={{ marginTop: 12 }}>TOOLS</div>
                <a className="sb-item" href="https://github.com/Shankar3423-web/soltracker" target="_blank" rel="noreferrer">
                    <GitIcon />
                    <span>GitHub</span>
                </a>
                <a className="sb-item" href="https://soltracker-g0h8.onrender.com/health" target="_blank" rel="noreferrer">
                    <ApiIcon />
                    <span>API Health</span>
                </a>
            </nav>

            <div className="sb-signin">
                {user ? (
                    <div className="sb-user-profile">
                        <img 
                            src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}&background=1d2133&color=e8eaf0`} 
                            alt="User Avatar" 
                            className="sb-user-avatar" 
                            referrerPolicy="no-referrer"
                        />
                        <div className="sb-user-info">
                            <div className="sb-user-text">
                                <span className="sb-user-name" title={user.displayName || user.email.split('@')[0]}>
                                    {user.displayName || user.email.split('@')[0]}
                                </span>
                                <span className="sb-user-email" title={user.email}>{user.email}</span>
                            </div>
                            <button className="sb-signout-btn" onClick={handleSignOut} title="Sign Out">
                                <LogoutIcon />
                            </button>
                        </div>
                    </div>
                ) : connected && walletAddress ? (
                    <div className="sb-user-profile">
                        <div 
                            className="sb-user-avatar" 
                            style={{ background: avatarGrad(walletAddress), borderRadius: '50%' }}
                        />
                        <div className="sb-user-info">
                            <div className="sb-user-text">
                                <span className="sb-user-name">
                                    {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                                </span>
                                <span className="sb-user-email" style={{ color: 'var(--accent)' }}>
                                    {solBalance.toFixed(3)} SOL
                                </span>
                            </div>
                            <button className="sb-signout-btn" onClick={handleWalletSignOut} title="Disconnect Wallet">
                                <LogoutIcon />
                            </button>
                        </div>
                    </div>
                ) : (
                    <button className="sb-signin-btn" onClick={() => setShowLogin(true)}>
                        <UserIcon />
                        <span>Sign In</span>
                    </button>
                )}
            </div>

            {showLogin && (
                <LoginModal onClose={() => setShowLogin(false)} />
            )}
        </aside>
    );
}

function Logo() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" stroke="#9945ff" strokeWidth="1.5" />
            <path d="M7 15.5L10.5 9l2.5 3.5L15 10l2 3" stroke="#9945ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function SolIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 16l2.5-4L12 15l2-3L16 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

function GitIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
        </svg>
    );
}

function ApiIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
        </svg>
    );
}

function UserIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    );
}

function LogoutIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
    );
}
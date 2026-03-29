import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useWallet } from '@solana/wallet-adapter-react';
import LoginModal from './LoginModal';
import { auth } from '../utils/firebase';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { avatarGrad } from '../utils/api';
import './Sidebar.css';

export default function Sidebar({ onSelectSolana }) {
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

    async function handleSignOut() {
        try {
            await signOut(auth);
        } catch (error) {
            console.error('Error signing out:', error);
        }
    }

    async function handleWalletSignOut() {
        try {
            localStorage.setItem('wallet_disconnected', 'true');
            await disconnect();
        } catch (error) {
            console.error('Error disconnecting wallet:', error);
        }
    }

    return (
        <aside className="sidebar">
            <div className="sb-logo">
                <Logo />
                <div className="sb-logo-copy">
                    <span className="sb-logo-text">SolTracker</span>
                    <span className="sb-logo-sub">Market terminal</span>
                </div>
            </div>

            <div className="sb-section">Network</div>

            <button type="button" className="sb-network-btn active" onClick={onSelectSolana}>
                <div className="sb-network-left">
                    <SolanaGlyph />
                    <span>Solana</span>
                </div>
                <span className="sb-live">LIVE</span>
            </button>

            <div className="sb-spacer" />

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
                            <button className="sb-signout-btn" onClick={handleSignOut} title="Sign Out" type="button">
                                <LogoutIcon />
                            </button>
                        </div>
                    </div>
                ) : connected && walletAddress ? (
                    <div className="sb-user-profile">
                        <div className="sb-user-avatar" style={{ background: avatarGrad(walletAddress) }} />
                        <div className="sb-user-info">
                            <div className="sb-user-text">
                                <span className="sb-user-name">
                                    {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                                </span>
                                <span className="sb-user-email accent">
                                    {solBalance.toFixed(3)} SOL
                                </span>
                            </div>
                            <button className="sb-signout-btn" onClick={handleWalletSignOut} title="Disconnect Wallet" type="button">
                                <LogoutIcon />
                            </button>
                        </div>
                    </div>
                ) : (
                    <button className="sb-signin-btn" onClick={() => setShowLogin(true)} type="button">
                        <UserIcon />
                        <span>Sign In</span>
                    </button>
                )}
            </div>

            {showLogin ? <LoginModal onClose={() => setShowLogin(false)} /> : null}
        </aside>
    );
}

function Logo() {
    return (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" stroke="#6fd0ff" strokeWidth="1.4" />
            <path d="M7 15.5L10.5 9l2.5 3.5L15 10l2 3" stroke="#6fd0ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function SolanaGlyph() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M7 16l2.5-4L12 15l2-3L16 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
    );
}

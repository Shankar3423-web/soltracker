import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useWallet } from '@solana/wallet-adapter-react';
import LoginModal from './LoginModal';
import UsernameModal from './UsernameModal';
import { auth } from '../utils/firebase';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { avatarGrad } from '../utils/api';
import './Sidebar.css';

export default function Sidebar({ onSelectSolana, onSelectWatchlist }) {
    const [showLogin, setShowLogin] = useState(false);
    const [user, setUser] = useState(null);
    const { walletAddress, connected, solBalance, username, setUsername, needsUsername, setNeedsUsername, avatarSeed } = useSolanaWallet();
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

            <div className="sb-section">Account</div>

            <button type="button" className="sb-network-btn" onClick={() => onSelectWatchlist()}>
                <div className="sb-network-left">
                    <StarIcon />
                    <span>Watchlist</span>
                </div>
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
                    <div className="sb-user-profile sb-wallet-card">
                        {/* Hover tooltip — opens to the RIGHT, always fully visible */}
                        <div className="sb-wallet-tooltip">
                            {/* Header strip */}
                            <div className="sb-wt-header">
                                <WalletAvatar address={walletAddress} seed={avatarSeed} size={34} className="sb-user-avatar sb-wt-avatar" />
                                <div className="sb-wt-header-text">
                                    <span className="sb-wt-username">
                                        {username || `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`}
                                    </span>
                                    <span className="sb-wt-badge">
                                        <span className="sb-wt-badge-dot" />
                                        Connected
                                    </span>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="sb-wt-body">
                                <div className="sb-wt-row">
                                    <span className="sb-wt-label">Wallet Address</span>
                                    <span className="sb-wt-value sb-wt-addr">{walletAddress}</span>
                                </div>

                                <div className="sb-wt-divider" />

                                <div className="sb-wt-row">
                                    <span className="sb-wt-label">Balance</span>
                                    <span className="sb-wt-sol-chip">
                                        <svg className="sb-wt-sol-chip-icon" viewBox="0 0 24 24" fill="none">
                                            <circle cx="12" cy="12" r="10.5" stroke="#6fd0ff" strokeWidth="1.4"/>
                                            <path d="M7 16l2.5-4L12 15l2-3L16 14" stroke="#6fd0ff" strokeWidth="1.6" strokeLinecap="round"/>
                                        </svg>
                                        {solBalance.toFixed(5)} SOL
                                    </span>
                                </div>
                            </div>
                        </div>

                        <WalletAvatar address={walletAddress} seed={avatarSeed} size={36} className="sb-user-avatar" />
                        <div className="sb-user-info">
                            <div className="sb-user-text">
                                <span className="sb-user-name">
                                    {username || `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`}
                                </span>
                                <span className="sb-user-wallet-addr">
                                    {`${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`}
                                </span>
                                <span className="sb-user-email accent">
                                    {solBalance.toFixed(5)} SOL
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

            {/* Username prompt — only shown once after wallet connects with no username */}
            {!showLogin && connected && walletAddress && needsUsername ? (
                <UsernameModal
                    walletAddress={walletAddress}
                    onSave={(name) => {
                        setUsername(name);
                        setNeedsUsername(false);
                    }}
                    onDismiss={() => setNeedsUsername(false)}
                />
            ) : null}
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

function StarIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    );
}

/**
 * WalletAvatar
 * Picks a unique SVG icon from a pool of 12 designs each session.
 * The `seed` prop (randomized on every wallet connect) selects the icon
 * and colour theme, so every sign-in feels fresh and engaging.
 */
function WalletAvatar({ address, seed, size, className, style }) {
    const s  = size || 36;
    const cx = s / 2;
    const cy = s / 2;

    // Derive hue from seed so colour changes each session too
    const hue  = ((seed || 0) * 137 + 42) % 360;
    const hue2 = (hue + 120) % 360;

    // Pick icon index from seed (0–11)
    const iconIdx = (seed || 0) % 12;

    // Unique gradient IDs
    const uid  = `wa-${address.slice(0, 5)}-${seed}`;
    const bgG  = `${uid}-bg`;
    const fgG  = `${uid}-fg`;

    // Scale factor to map 24-unit icon paths into our circle
    const p  = s * 0.14;                 // padding inside circle
    const is = s - p * 2;               // icon drawing area size
    const sc = is / 24;                  // scale for 24×24 viewBox paths

    // 12 icon path sets – each is an array of path-d strings
    const ICONS = [
        // 0 — Rocket 🚀
        ["M12 2C12 2 7 7 7 13c0 3 2.5 5 5 5s5-2 5-5c0-6-5-11-5-11z", "M10 18l-1.5 3h7L14 18", "M12 8a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"],
        // 1 — Diamond 💎
        ["M12 2L2 9l10 13L22 9z", "M2 9h20", "M12 2l-3 7m3-7l3 7", "M9 9l3 13m3-13l-3 13"],
        // 2 — Lightning ⚡
        ["M13 2L4.5 13H12l-1 9 8.5-11H12.5L13 2z"],
        // 3 — Crown 👑
        ["M3 18l2-10 4 5 3-8 3 8 4-5 2 10z", "M3 18h18v3H3z", "M12 5a1 1 0 100-2 1 1 0 000 2z", "M5 8a1 1 0 100-2 1 1 0 000 2z", "M19 8a1 1 0 100-2 1 1 0 000 2z"],
        // 4 — Flame 🔥
        ["M12 2c-4 6-7 9-7 13a7 7 0 0014 0c0-4-3-7-7-13z", "M12 22a3.5 3.5 0 003.5-3.5c0-2-3.5-5-3.5-5s-3.5 3-3.5 5A3.5 3.5 0 0012 22z"],
        // 5 — Shield 🛡️
        ["M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z", "M12 8l1.5 3H17l-2.5 2 1 3.5L12 14l-3.5 2.5 1-3.5L7 11h3.5z"],
        // 6 — Moon 🌙
        ["M21 12.79A9 9 0 0111.21 3 7 7 0 1021 12.79z", "M16 6a1 1 0 11-2 0 1 1 0 012 0z", "M19 10a0.7 0.7 0 11-1.4 0 0.7 0.7 0 011.4 0z"],
        // 7 — Star Burst ✦
        ["M12 1l2.5 7.5H22l-6 4.5L18.5 21 12 16.5 5.5 21 8 13 2 8.5h7.5z"],
        // 8 — Planet 🪐
        ["M12 17a5 5 0 100-10 5 5 0 000 10z", "M4.93 4.93c-1.4 1.4.42 4.56 4.07 7.07s5.67 4.47 7.07 3.07", "M19.07 4.93c1.4 1.4-.42 4.56-4.07 7.07s-5.67 4.47-7.07 3.07"],
        // 9 — Crystal 💠
        ["M12 2l5 8-5 12-5-12z", "M7 10l5 2 5-2", "M2 12l10 2 10-2-10 2z"],
        // 10 — Wolf 🐺
        ["M4 20l2-6-2-4 4 1 4-9 4 9 4-1-2 4 2 6", "M10 14a1 1 0 110-2 1 1 0 010 2z", "M14 14a1 1 0 110-2 1 1 0 010 2z", "M11 16h2l-1 1.5z"],
        // 11 — Dragon 🐉
        ["M6 20c0-6 3-9 6-12 3 3 6 6 6 12", "M12 8c-2-3-1-6 1-7 2 1 3 4 1 7", "M8 14c-3-1-5 0-5 2s2 2 5 2", "M16 14c3-1 5 0 5 2s-2 2-5 2"],
    ];

    const paths = ICONS[iconIdx];

    return (
        <svg
            width={s}
            height={s}
            viewBox={`0 0 ${s} ${s}`}
            className={className}
            style={style}
            aria-hidden="true"
        >
            <defs>
                <radialGradient id={bgG} cx="38%" cy="32%" r="72%">
                    <stop offset="0%"   stopColor={`hsl(${hue}, 45%, 18%)`} />
                    <stop offset="100%" stopColor={`hsl(${hue}, 25%, 7%)`}  />
                </radialGradient>
                <linearGradient id={fgG} x1="0" y1="0" x2="0.7" y2="1">
                    <stop offset="0%"   stopColor={`hsl(${hue},  92%, 64%)`} />
                    <stop offset="100%" stopColor={`hsl(${hue2}, 88%, 70%)`} />
                </linearGradient>
            </defs>

            {/* Dark circular background */}
            <circle cx={cx} cy={cy} r={s / 2} fill={`url(#${bgG})`} />

            {/* Subtle glow rim */}
            <circle
                cx={cx} cy={cy} r={s / 2 - 0.5}
                fill="none"
                stroke={`hsl(${hue}, 70%, 46%)`}
                strokeWidth={0.8}
                opacity={0.4}
            />

            {/* Icon paths — scaled & centred */}
            <g transform={`translate(${p}, ${p}) scale(${sc})`}>
                {paths.map((d, i) => (
                    <path
                        key={i}
                        d={d}
                        fill={i === 0 ? `url(#${fgG})` : `hsl(${hue2}, 80%, 72%)`}
                        opacity={i === 0 ? 0.92 : 0.6}
                        strokeLinejoin="round"
                    />
                ))}
            </g>

            {/* Specular highlight */}
            <ellipse
                cx={cx - s * 0.06}
                cy={cy - s * 0.10}
                rx={s * 0.10}
                ry={s * 0.055}
                fill="white"
                opacity={0.10}
                transform={`rotate(-30, ${cx}, ${cy})`}
            />
        </svg>
    );
}


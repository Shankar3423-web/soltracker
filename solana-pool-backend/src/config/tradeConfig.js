'use strict';

function getPlatformFeeBps() {
    const parsed = Number.parseInt(process.env.PLATFORM_FEE_BPS || '50', 10);
    if (!Number.isFinite(parsed)) {
        return 50;
    }

    return Math.max(0, Math.min(10000, parsed));
}

function getPlatformFeePercent() {
    return getPlatformFeeBps() / 100;
}

module.exports = {
    getPlatformFeeBps,
    getPlatformFeePercent,
};

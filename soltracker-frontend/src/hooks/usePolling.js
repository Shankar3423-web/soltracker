import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolling(fetchFn, deps, intervalMs) {
    const interval = intervalMs != null ? intervalMs : 8000;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const alive = useRef(true);

    const run = useCallback(function (isFirst) {
        fetchFn().then(function (r) {
            if (alive.current) { setData(r); setError(null); if (isFirst) setLoading(false); }
        }).catch(function (e) {
            if (alive.current) { setError(e.message); if (isFirst) setLoading(false); }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps || []);

    useEffect(function () {
        alive.current = true;
        setLoading(true);
        run(true);
        const t = interval > 0 ? setInterval(function () { run(false); }, interval) : null;
        return function () { alive.current = false; if (t) clearInterval(t); };
    }, [run, interval]);

    return { data, loading, error };
}
'use client';

// ADDED (Dark mode): theme state. The actual `.dark` class on <html> is the
// source of truth. CHANGED: the initial class is now baked into the SSR HTML from
// the `honey-theme` cookie (app/layout.tsx) instead of a pre-paint inline script
// (React 19 flags inline scripts). We read the class via useSyncExternalStore so
// it's SSR-safe and reactive, write the cookie on toggle so the server renders the
// right theme next load, and resolve first-time visitors (no cookie) on mount.

import {
    createContext,
    useContext,
    useEffect,
    useSyncExternalStore,
    type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';

const COOKIE = 'honey-theme';

function persistTheme(t: Theme) {
    // Cookie = the server-readable source for SSR; localStorage kept for back-compat.
    document.cookie = `${COOKIE}=${t}; path=/; max-age=31536000; SameSite=Lax`;
    try {
        localStorage.setItem(COOKIE, t);
    } catch {
        /* ignore (private mode) */
    }
}

function getSnapshot(): Theme {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
function getServerSnapshot(): Theme {
    return 'light';
}
function subscribe(onChange: () => void) {
    // Re-read whenever the <html> class changes (our toggle, or another tab).
    const obs = new MutationObserver(onChange);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
}

interface ThemeContextValue {
    theme: Theme;
    toggle: () => void;
    setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setTheme = (t: Theme) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
        persistTheme(t);
        // MutationObserver above fires → useSyncExternalStore re-reads → re-render.
    };

    // First visit (no cookie yet) — resolve the theme from a prior localStorage
    // choice, else the OS preference, and write the cookie so every later load is
    // SSR-correct (no flash). A returning user already has the cookie → this no-ops.
    useEffect(() => {
        if (document.cookie.includes(`${COOKIE}=`)) return;
        let saved: string | null = null;
        try {
            saved = localStorage.getItem(COOKIE);
        } catch {
            /* ignore */
        }
        const resolved: Theme =
            saved === 'dark' || saved === 'light'
                ? saved
                : window.matchMedia('(prefers-color-scheme: dark)').matches
                  ? 'dark'
                  : 'light';
        setTheme(resolved);
    }, []);

    const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

    return (
        <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
}

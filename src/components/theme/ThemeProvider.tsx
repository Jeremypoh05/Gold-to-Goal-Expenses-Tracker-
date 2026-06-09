'use client';

// ADDED (Dark mode): theme state. The actual `.dark` class on <html> is the
// source of truth (set pre-paint by the inline script in app/layout.tsx, then
// flipped here on toggle). We read it via useSyncExternalStore so it's SSR-safe
// and reactive — no setState-in-effect, no hydration mismatch on the value.

import {
    createContext,
    useContext,
    useSyncExternalStore,
    type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';

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
        try {
            localStorage.setItem('honey-theme', t);
        } catch {
            /* ignore (private mode) */
        }
        // MutationObserver above fires → useSyncExternalStore re-reads → re-render.
    };

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

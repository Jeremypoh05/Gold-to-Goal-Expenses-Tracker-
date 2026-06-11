'use client';

// ADDED (Phase 7 · Auth): ClerkProvider wrapper that follows Honey's theme.
// Sits inside ThemeProvider so it can read useTheme() and pass Clerk the `dark`
// base theme + gold accent — making the sign-in/up widgets and UserButton popover
// match the app in both light and dark.

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from '@/components/theme/ThemeProvider';

export function ClerkProviderThemed({ children }: { children: React.ReactNode }) {
    const { theme } = useTheme();

    return (
        <ClerkProvider
            appearance={{
                baseTheme: theme === 'dark' ? dark : undefined,
                variables: {
                    // Honey gold accent (hex approximation of --color-gold-500 oklch(0.72 0.165 82))
                    colorPrimary: '#d8a43c',
                    colorTextOnPrimaryBackground: '#1a120a',
                    borderRadius: '14px',
                    fontFamily: 'var(--font-ui)',
                },
            }}
        >
            {children}
        </ClerkProvider>
    );
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Plus_Jakarta_Sans, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// ADDED (Dark mode): theme context wrapping the whole app (incl. future landing/auth).
import { ThemeProvider } from "@/components/theme/ThemeProvider";
// ADDED (Phase 7 · Auth): Clerk provider, themed to follow the toggle.
import { ClerkProviderThemed } from "@/components/auth/ClerkProviderThemed";

// title (h1, hero text)
const plusJakartaSans = Plus_Jakarta_Sans({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-display-loaded',
  display: 'swap',
});

// UI fonts (buttons, body text)
const geist = Geist({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-ui-loaded',
  display: 'swap',
});

// number fonts (amounts, table data)
const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-mono-loaded',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Honey · Expense Tracker",
  description: "AI-powered voice expense tracking. Speak naturally to log expenses.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // CHANGED (Dark mode): theme is read from a cookie and baked into the SSR HTML
  // here — no pre-paint inline <script>. React 19 flags inline scripts rendered in
  // the component tree, and this also rules out any flash-of-wrong-theme for
  // returning users (the right class is in the first byte of HTML). First-time
  // visitors with no cookie get their OS preference applied on mount by ThemeProvider.
  const isDark = (await cookies()).get("honey-theme")?.value === "dark";
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${geist.variable} ${jetbrainsMono.variable}${isDark ? " dark" : ""}`}    >
      <body className="antialiased">
        <ThemeProvider>
          <ClerkProviderThemed>{children}</ClerkProviderThemed>
        </ThemeProvider>
      </body>
    </html>
  );
}
import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// ADDED (Dark mode): theme context wrapping the whole app (incl. future landing/auth).
import { ThemeProvider } from "@/components/theme/ThemeProvider";

// ADDED (Dark mode): runs before paint to set the .dark class from the saved
// choice, else the OS preference — prevents a light flash (FOUC) on load.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('honey-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${geist.variable} ${jetbrainsMono.variable}`}    >
      <head>
        {/* ADDED (Dark mode): pre-paint theme init to avoid a light flash (FOUC) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
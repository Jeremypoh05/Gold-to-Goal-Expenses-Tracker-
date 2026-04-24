import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// 显示标题字体 (h1, hero text)
const plusJakartaSans = Plus_Jakarta_Sans({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-display-loaded',
  display: 'swap',
});

// UI 字体 (按钮、正文)
const geist = Geist({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-ui-loaded',
  display: 'swap',
});

// 数字字体 (金额、表格数据)
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
      className={`${plusJakartaSans.variable} ${geist.variable} ${jetbrainsMono.variable}`}    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
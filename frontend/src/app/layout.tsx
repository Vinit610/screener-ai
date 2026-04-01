import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "screener-ai",
  description: "AI-first hybrid screener for self-directed Indian retail investors",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.className} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-white">
        <div className="bg-yellow-600 text-black text-center text-sm py-1 px-4">
          All AI outputs are educational insights only, not investment advice.
        </div>
        {children}
      </body>
    </html>
  );
}

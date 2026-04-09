import type { Metadata } from "next";
import { Sora, Source_Code_Pro } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://scatter-rehab.local"),
  title: "Scatter Rehab",
  description:
    "A mindful, no-real-money card-suit slot sandbox with local-only credits and offline support.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.svg", type: "image/svg+xml" },
      { url: "/icons/icon-512.svg", type: "image/svg+xml" },
    ],
    apple: "/icons/icon-192.svg",
  },
  applicationName: "Scatter Rehab",
  keywords: ["slot machine", "scatter", "rehab", "no real money", "pwa"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sora.variable} ${sourceCodePro.variable}`}>
      <body>{children}</body>
    </html>
  );
}

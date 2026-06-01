import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scout — the recruiting OS that wires into your stack",
  description:
    "A connection layer for Berlin tech. Warm intros through bridges who get paid when the candidate is placed.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}

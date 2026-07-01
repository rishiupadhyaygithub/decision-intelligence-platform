import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DecisionOS — grounded decision intelligence",
  description: "Every recommendation traces to a real, computed fact.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

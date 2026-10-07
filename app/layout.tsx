import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "myLibrary · Δημόσιες συλλογές βιβλίων",
  description: "Προσωπικές βιβλιοθήκες και δημόσιες συλλογές βιβλίων.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}

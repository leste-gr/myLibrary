import type { Metadata } from "next";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { AccountMenu } from "@/components/account-menu";

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
      <body><AccountMenu />{children}<SiteFooter /></body>
    </html>
  );
}

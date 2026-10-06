import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Η βιβλιοθήκη μου · Προσωπική συλλογή",
  description: "Η προσωπική βιβλιοθήκη του Λευτέρη.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="el">
      <body>{children}</body>
    </html>
  );
}

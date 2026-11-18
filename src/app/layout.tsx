import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GymTrack Stats",
  description: "Dashboard perso de GymTrack : Play Store, rétention, engagement, revenus.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Fraunces, Outfit } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import "../globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TaskPulse AI",
    template: "%s · TaskPulse AI",
  },
  description:
    "Autonomous voice negotiation and vendor dispatch for local service jobs — from inbound call to confirmed quote.",
  applicationName: "TaskPulse AI",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${outfit.variable} ${fraunces.variable}`}>
      <body className="min-h-screen font-sans text-foreground">
        <Navbar />
        {children}
      </body>
    </html>
  );
}

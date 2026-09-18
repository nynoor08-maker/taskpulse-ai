import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import "../globals.css";

export const metadata: Metadata = {
  title: "TaskPulse AI",
  description: "Autonomous voice negotiation and vendor dispatch for local service jobs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        <Navbar />
        {children}
      </body>
    </html>
  );
}

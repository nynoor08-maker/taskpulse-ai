import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import "../globals.css";

export const metadata: Metadata = {
  title: "TaskPulse AI",
  description: "AI-powered task management and vendor call tracking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className="min-h-screen bg-slate-50 text-slate-950"><Navbar />{children}</body></html>;
}

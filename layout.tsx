import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DashboardHeader } from "@/components/dashboard-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TaskPulse AI",
  description:
    "AI-powered task management and vendor call tracking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
        <DashboardHeader />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}

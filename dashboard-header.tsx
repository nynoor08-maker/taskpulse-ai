"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { LogIn, LogOut, Settings, History, ListTodo } from "lucide-react";

const navigation = [
  { href: "#tasks", label: "Tasks", icon: ListTodo },
  { href: "#call-history", label: "Call History", icon: History },
  { href: "#settings", label: "Settings", icon: Settings },
];

export function DashboardHeader() {
  const [isLoggedIn, setIsLoggedIn] = useState(true);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 p-1.5 shadow-sm dark:bg-white">
            <Image
              src="/cline-icon.svg"
              alt=""
              width={24}
              height={24}
              className="dark:invert"
            />
          </span>
          <span className="text-sm font-semibold tracking-tight text-slate-950 dark:text-white sm:text-base">
            TaskPulse AI
          </span>
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-white"
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className="hidden items-center gap-2 text-xs font-medium text-slate-500 md:inline-flex dark:text-slate-400"
            aria-live="polite"
          >
            <span
              className={[
                "size-2 rounded-full",
                isLoggedIn ? "bg-emerald-500" : "bg-slate-400",
              ].join(" ")}
            />
            {isLoggedIn ? "Signed in" : "Signed out"}
          </span>
          <button
            type="button"
            onClick={() => setIsLoggedIn((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
            aria-label={isLoggedIn ? "Log out" : "Log in"}
          >
            {isLoggedIn ? (
              <LogOut className="size-4" aria-hidden="true" />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {isLoggedIn ? "Log out" : "Log in"}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}

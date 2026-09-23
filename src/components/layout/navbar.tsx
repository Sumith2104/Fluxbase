"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { Database } from "lucide-react";

/**
 * Navbar Component
 * 
 * A responsive, glassmorphic navigation bar designed to be pinned to the top of the viewport.
 * Features:
 * - Brand logo and name
 * - Navigation links for landing page sections (Features)
 * - External link to documentation
 * - Children slot for dynamic content (like Login/Signup buttons)
 */
export default function Navbar({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <nav className="fixed left-1/2 top-11 z-50 w-[calc(100%-1rem)] max-w-5xl -translate-x-1/2 sm:top-12 sm:w-[95%]">
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/80 px-3 py-2 shadow-xl shadow-black/20 backdrop-blur-xl sm:px-6 sm:py-3">
                {/* Logo + Brand */}
                <Link href="/" className="group flex min-w-0 items-center gap-2">
                    <Database className="h-5 w-5 text-primary shrink-0" />
                    <span className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
                        Fluxbase
                    </span>
                </Link>

                {/* Nav Links & Actions */}
                <div className="flex min-w-0 shrink-0 items-center gap-2 text-sm sm:gap-6">
                    <div className="hidden sm:flex items-center gap-6">
                        <Link
                            href="/#features"
                            className={`transition-colors ${pathname === "/#features"
                                ? "text-primary"
                                : "text-muted-foreground hover:text-primary"
                                }`}
                        >
                            Features
                        </Link>

                        <Link
                            href="/pricing"
                            className={`transition-colors ${pathname === "/pricing"
                                ? "text-primary"
                                : "text-muted-foreground hover:text-primary"
                                }`}
                        >
                            Pricing
                        </Link>

                        <Link
                            href="/ai-models"
                            className={`transition-colors ${pathname === "/ai-models"
                                ? "text-primary font-semibold"
                                : "text-muted-foreground hover:text-primary"
                                }`}
                        >
                            AI Models
                        </Link>

                        <Link
                            href="/docs"
                            className={`transition-colors ${pathname === "/docs"
                                ? "text-primary"
                                : "text-muted-foreground hover:text-primary"
                                }`}
                        >
                            Docs
                        </Link>
                    </div>

                    {/* Vertical Separator */}
                    <div className="mx-2 hidden h-6 w-px bg-border sm:block"></div>

                    {/* Authentication Actions / Children */}
                    <div className="flex items-center gap-1.5 sm:gap-2 [&_button]:h-9 [&_button]:px-3 sm:[&_button]:h-10 sm:[&_button]:px-4">
                        {children}
                    </div>
                </div>
            </div>
        </nav>
    );
}

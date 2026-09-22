'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log to client console for debugging
        console.error('App Router Caught Error:', error);
    }, [error]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] text-white p-6">
            <div className="max-w-md w-full text-center space-y-6 bg-[#121216] border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
                <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                    <AlertTriangle className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight text-white">Something went wrong</h1>
                    <p className="text-sm text-zinc-400">
                        An unexpected application error occurred. You can try reloading this section or return to safety.
                    </p>
                    {error.digest && (
                        <p className="text-xs font-mono text-zinc-600">
                            Error Reference: {error.digest}
                        </p>
                    )}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                    <button
                        onClick={() => reset()}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black font-medium text-sm transition-colors shadow-lg shadow-emerald-500/20"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                    <Link
                        href="/dashboard/projects"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-sm transition-colors"
                    >
                        <Home className="w-4 h-4" />
                        Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}

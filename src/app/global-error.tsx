'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertOctagon, RefreshCw } from 'lucide-react';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('Global Layout Error:', error);
    }, [error]);

    return (
        <html lang="en" className="dark">
            <body className="bg-[#0a0a0c] text-white min-h-screen flex items-center justify-center p-6 font-sans antialiased">
                <div className="max-w-md w-full text-center space-y-6 bg-[#121216] border border-white/10 rounded-2xl p-8 shadow-2xl">
                    <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                        <AlertOctagon className="w-8 h-8" />
                    </div>

                    <div className="space-y-2">
                        <h1 className="text-2xl font-bold tracking-tight text-white">Application Exception</h1>
                        <p className="text-sm text-zinc-400">
                            A critical system error occurred. We have isolated the issue to prevent data corruption.
                        </p>
                        {error.digest && (
                            <p className="text-xs font-mono text-zinc-600">
                                Trace ID: {error.digest}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                        <button
                            onClick={() => reset()}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black font-medium text-sm transition-colors shadow-lg shadow-emerald-500/20 cursor-pointer"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Recover Application
                        </button>
                        <a
                            href="/"
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-sm transition-colors"
                        >
                            Reload Home
                        </a>
                    </div>
                </div>
            </body>
        </html>
    );
}

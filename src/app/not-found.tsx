import React from 'react';
import Link from 'next/link';
import { Compass, Home, LayoutDashboard } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0c] text-white p-6">
            <div className="max-w-md w-full text-center space-y-6 bg-[#121216] border border-white/10 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
                <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Compass className="w-8 h-8 animate-pulse" />
                </div>

                <div className="space-y-2">
                    <div className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">404 Error</div>
                    <h1 className="text-2xl font-bold tracking-tight text-white">Page Not Found</h1>
                    <p className="text-sm text-zinc-400">
                        The page or resource you are looking for does not exist, was moved, or requires higher permissions to view.
                    </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                    <Link
                        href="/"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium text-sm transition-colors"
                    >
                        <Home className="w-4 h-4" />
                        Home
                    </Link>
                    <Link
                        href="/dashboard/projects"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-black font-medium text-sm transition-colors shadow-lg shadow-emerald-500/20"
                    >
                        <LayoutDashboard className="w-4 h-4" />
                        Go to Dashboard
                    </Link>
                </div>
            </div>
        </div>
    );
}

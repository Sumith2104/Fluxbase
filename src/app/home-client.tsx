'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
    Database,
    Zap,
    BrainCircuit,
    Code,
    Table as TableIcon,
    Layout,
    ArrowRight,
    Github,
    Twitter,
    ServerCrash
} from 'lucide-react';
import { motion } from 'framer-motion';

import Aurora from '@/components/Aurora';
import Navbar from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { checkDatabaseHealthAction } from '@/lib/data';
import InteractiveShowcase from '@/components/landing/interactive-showcase';

const LoginDialog = dynamic(() => import('@/components/auth/login-dialog').then(mod => mod.LoginDialog), {
    ssr: false,
    loading: () => <Button variant="ghost">Login</Button>
});
const SignupDialog = dynamic(() => import('@/components/auth/signup-dialog').then(mod => mod.SignupDialog), {
    ssr: false,
    loading: () => <Button>Sign Up</Button>
});

export default function Home() {
    const colors = ['#121212', '#ff7a1a', '#1a1a18'];
    const [loginOpen, setLoginOpen] = useState(false);
    const [signupOpen, setSignupOpen] = useState(false);
    const [isOffline, setIsOffline] = useState(false);

    useEffect(() => {
        checkDatabaseHealthAction().then(isHealthy => setIsOffline(!isHealthy));
        fetch('/api/auth/session')
            .then(res => res.json())
            .then(data => {
                if (data?.authenticated || data?.user?.id) {
                    window.location.href = '/dashboard/projects';
                }
            })
            .catch(() => {});
    }, []);

    const openSignup = () => {
        setLoginOpen(false);
        setSignupOpen(true);
    }

    const openLogin = () => {
        setSignupOpen(false);
        setLoginOpen(true);
    }

    const fadeIn = {
        initial: { opacity: 0, y: 20 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.6 }
    };

    return (
        <div className="flex flex-col min-h-screen bg-background text-foreground overflow-x-hidden">
            <Navbar>
                <LoginDialog
                    isGhost={true}
                    open={loginOpen}
                    onOpenChange={setLoginOpen}
                    onSwitchToSignup={openSignup}
                />
                <SignupDialog
                    open={signupOpen}
                    onOpenChange={setSignupOpen}
                    onSwitchToLogin={openLogin}
                />
            </Navbar>

            {/* Hero Section */}
            <section className="relative flex min-h-[82svh] items-center justify-center overflow-hidden px-0 pt-24 pb-12 sm:min-h-[86vh] sm:pt-20 sm:pb-0">
                <div className="absolute inset-0 z-0">
                    <div className="dot-grid-bg absolute inset-0 opacity-30" />
                    <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/[0.07] rounded-full blur-[120px]" />
                </div>
                <div className="relative z-10 mx-auto max-w-4xl space-y-7 px-5 text-center sm:space-y-8">
                    <div className="flex flex-col items-center gap-3">
                        {isOffline && (
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ duration: 0.5 }}
                                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium"
                            >
                                <ServerCrash className="h-4 w-4" />
                                <span>Fluxbase is undergoing maintenance - we'll be right back!</span>
                            </motion.div>
                        )}

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.5 }}
                            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border text-muted-foreground text-xs font-mono"
                        >
                            <Zap className="h-3 w-3" />
                            <span>v0.5 is now live</span>
                        </motion.div>
                    </div>
                    <motion.h1
                        {...fadeIn}
                        className="text-5xl font-bold leading-[0.96] tracking-tight text-foreground sm:text-7xl md:text-8xl"
                    >
                        Data Management <br />
                        <span className="text-primary/90">Redefined.</span>
                    </motion.h1>
                    <motion.p
                        {...fadeIn}
                        transition={{ delay: 0.2 }}
                        className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg md:text-xl"
                    >
                        The modern, AI-powered spreadsheet and data analysis tool. Manage projects, create tables, and unlock insights with natural language queries.
                    </motion.p>
                    <motion.div
                        {...fadeIn}
                        transition={{ delay: 0.4 }}
                        className="flex flex-col justify-center gap-3 pt-2 sm:flex-row sm:gap-4 sm:pt-4"
                    >
                        <Button size="lg" className="group h-12 w-full px-8 text-base transition-shadow hover:shadow-[0_0_24px_hsl(26_100%_57%/0.3)] sm:w-auto" onClick={() => setSignupOpen(true)}>
                            Get Started Free
                            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                        <Button variant="ghost" size="lg" className="h-12 w-full px-8 text-base text-muted-foreground hover:text-foreground sm:w-auto" onClick={() => setLoginOpen(true)}>
                            Sign In
                        </Button>
                    </motion.div>
                </div>
            </section>

            {/* Interactive Platform Showcase (Live SQL, Schema, Traffic, Storage, SDK) */}
            <InteractiveShowcase />

            {/* Features Section */}
            <section id="features" className="relative z-10 bg-background px-5 py-16 sm:px-4 sm:py-24">
                <div className="max-w-5xl mx-auto">
                    <div className="mb-10 space-y-4 text-center sm:mb-16">
                        <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">Built for Developers</h2>
                        <p className="mx-auto max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                            Everything you need to manage complex datasets without the overhead of a traditional database administrator.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border-t border-l border-border/60">
                        {[
                            {
                                title: "AI SQL Assistant",
                                description: "Convert natural language into complex SQL queries instantly. No more memorizing syntax.",
                                icon: <BrainCircuit className="h-5 w-5" />,
                                delay: 0
                            },
                            {
                                title: "Spreadsheet Interface",
                                description: "Familiar Excel-like grid for lightning fast data entry and bulk editing operations.",
                                icon: <TableIcon className="h-5 w-5" />,
                                delay: 0.1
                            },
                            {
                                title: "Instant API Gen",
                                description: "Automatically generate REST endpoints for every table you create. Ready for production.",
                                icon: <Code className="h-5 w-5" />,
                                delay: 0.2
                            },
                            {
                                title: "Visual Database",
                                description: "Automatically generated ERD diagrams that update in real-time as your schema evolves.",
                                icon: <Database className="h-5 w-5" />,
                                delay: 0.3
                            },
                            {
                                title: "Mock Storage",
                                description: "Manage related files and folders directly alongside your tabular data in one place.",
                                icon: <Layout className="h-5 w-5" />,
                                delay: 0.4
                            },
                            {
                                title: "Cloud Native",
                                description: "Built for the modern web with real-time sync and seamless cloud storage.",
                                icon: <Zap className="h-5 w-5" />,
                                delay: 0.5
                            }
                        ].map((feature, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 12 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: feature.delay, duration: 0.4 }}
                                className="group border-r border-b border-border/60 p-6 sm:p-8 transition-colors hover:bg-card/40"
                            >
                                <div className="mb-4 text-muted-foreground transition-colors group-hover:text-primary">
                                    {feature.icon}
                                </div>
                                <h3 className="text-base font-medium text-foreground mb-2">{feature.title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {feature.description}
                                </p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Pricing Section */}


            {/* Footer */}
            <footer className="border-t border-border/40 px-5 py-10 sm:px-4 sm:py-14">
                <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-6 md:flex-row md:gap-8">
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-primary" />
                        <span className="font-semibold text-lg">Fluxbase</span>
                    </div>
                    <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground sm:gap-8">
                        <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
                        <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
                        <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
                        <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-foreground">
                            <Github className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-foreground">
                            <Twitter className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
                <div className="text-center text-xs text-muted-foreground/60 mt-10 font-mono">
                    © {new Date().getFullYear()} Fluxbase Inc.
                </div>
            </footer>
        </div>
    );
}

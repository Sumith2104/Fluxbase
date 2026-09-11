"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Github, Shield, Loader2, Sparkles, KeyRound, Mail, ArrowLeft, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { loginAction, verify2FALoginAction, sendPasswordlessOtpAction, verifyPasswordlessOtpAction } from "@/app/actions";

interface LoginDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSwitchToSignup: () => void;
    isGhost?: boolean;
}

export function LoginDialog({ open, onOpenChange, onSwitchToSignup, isGhost }: LoginDialogProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [authMode, setAuthMode] = useState<'password' | 'otp'>('password');
    const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
    const [magicEmail, setMagicEmail] = useState('');
    const [magicOtpCode, setMagicOtpCode] = useState('');
    const [showForgotPass, setShowForgotPass] = useState(false);
    const [requires2FA, setRequires2FA] = useState(false);
    const [tempUserId, setTempUserId] = useState<string | null>(null);
    const [twoFactorCode, setTwoFactorCode] = useState('');
    const [lastMethod, setLastMethod] = useState<string | null>(null);

    // Hydrate last login method from localStorage on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            setLastMethod(localStorage.getItem('lastLoginMethod'));
        }
    }, [open]);

    const [socialLoading, setSocialLoading] = useState<'google' | 'github' | null>(null);

    const handleSocialLogin = (provider: 'google' | 'github') => {
        if (socialLoading || isLoading) return;
        setSocialLoading(provider);
        setIsLoading(true);
        localStorage.setItem('lastLoginMethod', provider);
        window.location.href = `/api/auth/${provider}`;
    };

    // Listen for URL params in case of GitHub 2FA or Magic Login errors
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('requires2FA') === 'true' && params.get('userId')) {
                setRequires2FA(true);
                setTempUserId(params.get('userId'));
                onOpenChange(true);
            }
            if (params.get('error')) {
                const errorKey = params.get('error');
                let message = 'Authentication link was invalid or expired. Please sign in again.';
                if (errorKey === 'expired_token') message = 'This magic login link has expired. Please request a new code.';
                if (errorKey === 'invalid_or_consumed_token') message = 'This magic link has already been used. Please request a new one.';
                toast({
                    variant: 'destructive',
                    title: 'Sign In Failed',
                    description: message,
                });
                onOpenChange(true);
            }
        }
    }, [onOpenChange, toast]);

    async function handleEmailLogin(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsLoading(true);
        localStorage.setItem('lastLoginMethod', 'email');
        const formData = new FormData(event.currentTarget);

        try {
            const result = await loginAction(formData);

            if (result.success) {
                if (result.requires2FA && result.userId) {
                    setRequires2FA(true);
                    setTempUserId(result.userId);
                } else {
                    onOpenChange(false);
                    router.push('/dashboard/projects');
                    router.refresh();
                }
            } else {
                throw new Error(result.error || 'Failed to create session');
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Login Failed',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSendMagicOtp(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsLoading(true);
        const formData = new FormData(event.currentTarget);
        const email = (formData.get('email') as string)?.trim();
        setMagicEmail(email);

        try {
            const result = await sendPasswordlessOtpAction(formData);
            if (result.success) {
                toast({
                    title: 'Sign-In Code & Link Sent',
                    description: `Check your inbox (${email}) for your 6-digit code or 1-click sign-in button.`,
                });
                setOtpStep('verify');
            } else {
                throw new Error(result.error || 'Failed to send login code');
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Request Failed',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleVerifyMagicOtp(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsLoading(true);
        const formData = new FormData();
        formData.append('email', magicEmail);
        formData.append('otp', magicOtpCode);

        try {
            const result = await verifyPasswordlessOtpAction(formData);
            if (result.success) {
                if (result.requires2FA && result.userId) {
                    setRequires2FA(true);
                    setTempUserId(result.userId);
                } else {
                    toast({
                        title: 'Welcome Back!',
                        description: 'Signed in successfully with one-time code.',
                    });
                    onOpenChange(false);
                    router.push('/dashboard/projects');
                    router.refresh();
                }
            } else {
                throw new Error(result.error || 'Invalid or expired code');
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Verification Failed',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleResendMagicOtp() {
        if (!magicEmail) return;
        setIsLoading(true);
        const formData = new FormData();
        formData.append('email', magicEmail);

        try {
            const result = await sendPasswordlessOtpAction(formData);
            if (result.success) {
                toast({
                    title: 'New Code Sent',
                    description: `A fresh 6-digit code has been dispatched to ${magicEmail}.`,
                });
            } else {
                throw new Error(result.error || 'Failed to resend code');
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Resend Failed',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleVerify2FA(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!tempUserId) return;

        setIsLoading(true);
        try {
            const result = await verify2FALoginAction(tempUserId, twoFactorCode);

            if (result.success) {
                onOpenChange(false);
                router.push('/dashboard/projects');
                router.refresh();
            } else {
                throw new Error(result.error || 'Invalid 2FA code');
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Verification Failed',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }

    async function handleForgotPass(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsLoading(true);
        const formData = new FormData(event.currentTarget);
        const email = formData.get('email') as string;

        try {
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (response.ok) {
                toast({
                    title: 'Reset Link Sent',
                    description: 'Check your email for instructions to reset your password.',
                });
                setShowForgotPass(false);
            } else {
                throw new Error(data.error || 'Failed to send reset link');
            }
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Request Failed',
                description: error.message,
            });
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) {
                setShowForgotPass(false);
                setRequires2FA(false);
                setOtpStep('request');
                setMagicOtpCode('');
            }
            onOpenChange(val);
        }}>
            <DialogTrigger asChild>
                <Button variant={isGhost ? "ghost" : "default"}>Login</Button>
            </DialogTrigger>
            <DialogContent className="border-border/70 bg-secondary/40 shadow-2xl backdrop-blur-3xl !rounded-2xl sm:max-w-[420px] sm:!rounded-[40px]">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold">
                        {requires2FA
                            ? "Two-Factor Authentication"
                            : showForgotPass
                                ? "Reset Password"
                                : authMode === 'otp'
                                    ? otpStep === 'verify' ? "Enter Verification Code" : "Passwordless Login"
                                    : "Login"}
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground/90 text-sm">
                        {requires2FA 
                            ? "Enter the 6-digit code from your authenticator app" 
                            : showForgotPass 
                                ? "Enter your email to receive a password reset link" 
                                : authMode === 'otp'
                                    ? otpStep === 'verify'
                                        ? `Enter the 6-digit code sent to ${magicEmail} or click the link in your email`
                                        : "Sign in instantly with a one-time code or email magic link"
                                    : "Enter your credentials below to access your account"}
                    </DialogDescription>
                </DialogHeader>

                {requires2FA ? (
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/20 rounded-lg mb-4">
                            <Shield className="h-5 w-5 text-primary shrink-0" />
                            <p className="text-sm text-foreground/90">Authentication required to protect your account.</p>
                        </div>
                        <form onSubmit={handleVerify2FA} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="2fa-code" className="text-center block text-muted-foreground uppercase text-xs font-bold tracking-widest">Verification Code</Label>
                                <Input
                                    id="2fa-code"
                                    type="text"
                                    placeholder="000000"
                                    maxLength={6}
                                    required
                                    className="text-center text-3xl h-16 tracking-[0.5em] font-mono border-border/70 bg-background/70 focus-visible:ring-2 focus-visible:ring-primary"
                                    value={twoFactorCode}
                                    onChange={(e) => setTwoFactorCode(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-6 text-lg" disabled={isLoading || twoFactorCode.length !== 6}>
                                {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                {isLoading ? 'Verifying...' : 'Verify & Login'}
                            </Button>
                            <Button variant="ghost" type="button" onClick={() => {
                                setRequires2FA(false);
                                setTwoFactorCode('');
                                setTempUserId(null);
                            }} className="w-full hover:bg-secondary/40" disabled={isLoading}>
                                Cancel
                            </Button>
                        </form>
                    </div>
                ) : showForgotPass ? (
                    <div className="space-y-4 pt-2">
                        <form onSubmit={handleForgotPass} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="reset-email">Email Address</Label>
                                <Input id="reset-email" name="email" type="email" placeholder="m@example.com" required className="border-border/70 bg-background/70" />
                            </div>
                            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-5" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {isLoading ? 'Sending Link...' : 'Send Reset Link'}
                            </Button>
                            <Button variant="ghost" type="button" onClick={() => setShowForgotPass(false)} className="w-full hover:bg-secondary/40" disabled={isLoading}>
                                Back to Login
                            </Button>
                        </form>
                    </div>
                ) : authMode === 'otp' && otpStep === 'verify' ? (
                    /* OTP Verification Screen */
                    <div className="space-y-4 pt-2">
                        <div className="p-3.5 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center gap-3 text-xs text-orange-200/90">
                            <Mail className="h-4 w-4 text-orange-400 shrink-0" />
                            <span>You can either type the 6-digit code below <b>or</b> click the sign-in button in your email!</span>
                        </div>
                        <form onSubmit={handleVerifyMagicOtp} className="space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="magic-otp-input" className="text-center block text-muted-foreground uppercase text-xs font-bold tracking-wider">
                                    6-Digit Sign-In Code
                                </Label>
                                <Input
                                    id="magic-otp-input"
                                    type="text"
                                    placeholder="000000"
                                    maxLength={6}
                                    required
                                    className="text-center text-3xl h-16 tracking-[0.4em] font-mono border-border/70 bg-background/70 focus-visible:ring-2 focus-visible:ring-orange-500"
                                    value={magicOtpCode}
                                    onChange={(e) => setMagicOtpCode(e.target.value.replace(/\D/g, ''))}
                                    autoFocus
                                />
                            </div>
                            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-6 text-base" disabled={isLoading || magicOtpCode.length !== 6}>
                                {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                                {isLoading ? 'Authenticating...' : 'Verify & Sign In'}
                            </Button>
                            <div className="flex items-center justify-between text-xs pt-1">
                                <Button variant="ghost" size="sm" type="button" onClick={handleResendMagicOtp} disabled={isLoading} className="text-muted-foreground hover:text-white px-2">
                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Resend Code
                                </Button>
                                <Button variant="ghost" size="sm" type="button" onClick={() => { setOtpStep('request'); setMagicOtpCode(''); }} className="text-muted-foreground hover:text-white px-2">
                                    Change Email
                                </Button>
                            </div>
                        </form>
                    </div>
                ) : (
                    /* Main Login Screen (Password or Passwordless OTP Request) */
                    <div className="space-y-4 pt-2">
                        {/* Social Buttons */}
                        <div className="grid grid-cols-2 gap-2 sm:gap-4">
                            <Button onClick={() => handleSocialLogin('google')} variant="outline" type="button" disabled={isLoading || !!socialLoading} className={cn("border-border/70 relative hover:bg-secondary/40 hover:text-white transition-colors", lastMethod === 'google' && "border-primary/50 bg-primary/5")}>
                                {lastMethod === 'google' && <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap z-10">Last Used</span>}
                                {socialLoading === 'google' ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                        <path d="M5.84 14.17c-.22-.66-.35-1.36-.35-2.17s.13-1.51.35-2.17V7.01H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.99l3.66-2.82z" fill="#FBBC05" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.01l3.66 2.82c.87-2.6 3.3-4.45 6.16-4.45z" fill="#EA4335" />
                                    </svg>
                                )}
                                {socialLoading === 'google' ? 'Connecting...' : 'Google'}
                            </Button>
                            <Button onClick={() => handleSocialLogin('github')} variant="outline" type="button" disabled={isLoading || !!socialLoading} className={cn("border-border/70 relative hover:bg-secondary/40 hover:text-white transition-colors", lastMethod === 'github' && "border-primary/50 bg-primary/5")}>
                                {lastMethod === 'github' && <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap z-10">Last Used</span>}
                                {socialLoading === 'github' ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Github className="mr-2 h-4 w-4" />
                                )}
                                {socialLoading === 'github' ? 'Connecting...' : 'GitHub'}
                            </Button>
                        </div>

                        <div className="relative my-2">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-border/60" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-secondary/40 px-2 text-muted-foreground font-medium backdrop-blur-md rounded">Or continue with</span>
                            </div>
                        </div>

                        {/* Mode Selector Tabs (Password vs Passwordless OTP) */}
                        <div className="grid grid-cols-2 p-1 bg-background/50 border border-border/60 rounded-xl mb-4 text-xs font-medium">
                            <button
                                type="button"
                                onClick={() => setAuthMode('password')}
                                className={cn(
                                    "py-2 rounded-lg transition-all flex items-center justify-center gap-1.5",
                                    authMode === 'password'
                                        ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                                        : "text-muted-foreground hover:text-white"
                                )}
                            >
                                <KeyRound className="h-3.5 w-3.5" />
                                Password
                            </button>
                            <button
                                type="button"
                                onClick={() => setAuthMode('otp')}
                                className={cn(
                                    "py-2 rounded-lg transition-all flex items-center justify-center gap-1.5",
                                    authMode === 'otp'
                                        ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                                        : "text-muted-foreground hover:text-white"
                                )}
                            >
                                <Mail className="h-3.5 w-3.5" />
                                One-Time OTP / Link
                            </button>
                        </div>

                        {authMode === 'password' ? (
                            /* Standard Password Form */
                            <form onSubmit={handleEmailLogin} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email" className="text-foreground/90">Email Address</Label>
                                    <Input
                                        id="email"
                                        name="email"
                                        type="email"
                                        placeholder="m@example.com"
                                        required
                                        className="border-border/70 bg-background/70 focus-visible:ring-2 focus-visible:ring-orange-500 placeholder:text-muted-foreground/50"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="password" className="text-foreground/90">Password</Label>
                                        <span onClick={() => setShowForgotPass(true)} className="text-xs text-orange-400 hover:text-orange-300 hover:underline cursor-pointer font-medium transition-colors">Forgot password?</span>
                                    </div>
                                    <PasswordInput
                                        id="password"
                                        name="password"
                                        required
                                        className="border-border/70 bg-background/70 focus-visible:ring-2 focus-visible:ring-orange-500"
                                    />
                                </div>
                                <Button type="submit" className={cn("w-full transition-all duration-300 py-5 font-semibold", lastMethod === 'email' && "ring-2 ring-primary ring-offset-2 ring-offset-zinc-950")} disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {isLoading ? 'Logging In...' : 'Sign In with Password'}
                                </Button>
                            </form>
                        ) : (
                            /* Passwordless Magic OTP Request Form */
                            <form onSubmit={handleSendMagicOtp} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="magic-email" className="text-foreground/90">Email Address</Label>
                                    <Input
                                        id="magic-email"
                                        name="email"
                                        type="email"
                                        placeholder="m@example.com"
                                        defaultValue={magicEmail}
                                        required
                                        className="border-border/70 bg-background/70 focus-visible:ring-2 focus-visible:ring-orange-500 placeholder:text-muted-foreground/50"
                                    />
                                    <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                                        We will send a 6-digit code and a 1-click instant login link to this address.
                                    </p>
                                </div>
                                <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-5" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {isLoading ? 'Sending Code...' : 'Send Sign-In Code & Link'}
                                </Button>
                            </form>
                        )}

                        <div className="text-center text-sm text-muted-foreground mt-4 flex items-center justify-center gap-1.5 flex-col xs:flex-row">
                            Don't have an account?{' '}
                            <span onClick={onSwitchToSignup} className="cursor-pointer text-primary hover:underline font-medium">
                                Sign up
                            </span>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

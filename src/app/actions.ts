"use server";

import { getPgPool } from "@/lib/pg";
import { createSessionCookie } from "@/lib/auth";
import { sendOtpEmail, sendWelcomeEmail, sendMagicLoginEmail } from "@/lib/email";

import { cookies, headers } from "next/headers";
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import logger from '@/lib/logger';

export async function signupAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;

  if (!email || !password || !name) {
    return { error: "Missing fields" };
  }

  try {
    const pool = getPgPool();

    // Check if email already exists in main users table
    const existing = await pool.query('SELECT id FROM fluxbase_global.users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return { error: "Email already exists" };
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 minutes

    // Upsert into isolated otp_verifications table
    await pool.query(`
      INSERT INTO fluxbase_global.otp_verifications (email, name, password_hash, otp_code, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        otp_code = EXCLUDED.otp_code,
        expires_at = EXCLUDED.expires_at
    `, [email, name, passwordHash, otp, expiresAt]);

    // Send OTP email asynchronously
    sendOtpEmail(email, name, otp).catch((e) => { logger.error(e); });

    return { success: true, requireOtp: true, email };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function verifyOtpAction(formData: FormData) {
  const email = formData.get("email") as string;
  const otp = formData.get("otp") as string;

  if (!email || !otp) {
    return { error: "Missing email or OTP" };
  }

  try {
    const pool = getPgPool();
    const pendingResult = await pool.query(
      'SELECT name, password_hash, otp_code, expires_at FROM fluxbase_global.otp_verifications WHERE email = $1',
      [email]
    );

    if (pendingResult.rows.length === 0) {
      return { error: "No pending verification found for this email. Please sign up again." };
    }

    const pendingUser = pendingResult.rows[0];

    if (pendingUser.otp_code !== otp) {
      return { error: "Invalid verification code." };
    }

    if (new Date() > new Date(pendingUser.expires_at)) {
      // Expired, clear it out.
      await pool.query('DELETE FROM fluxbase_global.otp_verifications WHERE email = $1', [email]);
      return { error: "Verification code has expired. Please sign up again." };
    }

    // OTP Valid! Create the real user from the pending hash
    const userId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO fluxbase_global.users (id, email, display_name, password_hash) VALUES ($1::text, $2, $3, $4)',
      [userId, email, pendingUser.name, pendingUser.password_hash]
    );

    // Cleanup pending verification
    await pool.query('DELETE FROM fluxbase_global.otp_verifications WHERE email = $1', [email]);

    // Securely log them in
    await createSessionCookie(userId, true);

    // Send uniform Welcome Email for native registration
    sendWelcomeEmail(email, pendingUser.name).catch((e) => { logger.error(e); });

    return { success: true };
  } catch (error: any) {
    logger.error("OTP Verification Error:", error);
    return { error: error.message };
  }
}

export async function loginAction(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Missing fields" };
  }

  try {
    const pool = getPgPool();
    const result = await pool.query('SELECT id, password_hash, two_factor_enabled FROM fluxbase_global.users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return { error: "No account found with this email." };
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return { error: "Invalid account configuration (No password)." };
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return { error: "Invalid password." };
    }

    // Check for 2FA (retrieved in initial query)
    if (user.two_factor_enabled) {
      return { success: true, requires2FA: true, userId: user.id };
    }

    await createSessionCookie(user.id, true);
    return { success: true };
  } catch (error: any) {
    logger.error("Native Login Error:", error);
    return { error: "Authentication failed. Please try again." };
  }
}

export async function sendPasswordlessOtpAction(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase();

  if (!email) {
    return { error: "Email is required" };
  }

  try {
    const pool = getPgPool();

    // 1. Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fluxbase_global.magic_logins (
        email VARCHAR(255) PRIMARY KEY,
        otp_code VARCHAR(10) NOT NULL,
        magic_token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // 2. Generate 6-digit OTP and 32-byte high-entropy session/magic token
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 minutes

    // 3. Upsert into magic_logins
    await pool.query(`
      INSERT INTO fluxbase_global.magic_logins (email, otp_code, magic_token, expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        otp_code = EXCLUDED.otp_code,
        magic_token = EXCLUDED.magic_token,
        expires_at = EXCLUDED.expires_at
    `, [email, otp, token, expiresAt]);

    // 4. Retrieve display name if user exists
    const userRes = await pool.query('SELECT display_name FROM fluxbase_global.users WHERE email = $1', [email]);
    const name = userRes.rows[0]?.display_name || email.split('@')[0];

    const headersList = await headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
    const proto = headersList.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const baseUrl = isLocal ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_APP_URL || 'https://fluxbasedb.me');
    const magicLink = `${baseUrl}/api/auth/magic-login?token=${token}&email=${encodeURIComponent(email)}`;

    // 5. Send Branded Email
    await sendMagicLoginEmail(email, name, otp, magicLink);

    return { success: true, email };
  } catch (error: any) {
    logger.error("Passwordless OTP request error:", error);
    return { error: error.message || "Failed to send login code" };
  }
}

export async function verifyPasswordlessOtpAction(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const otp = (formData.get("otp") as string)?.trim();

  if (!email || !otp) {
    return { error: "Missing email or code" };
  }

  try {
    const pool = getPgPool();

    const result = await pool.query(
      'SELECT otp_code, magic_token, expires_at FROM fluxbase_global.magic_logins WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return { error: "No pending login code found for this email. Please request a new one." };
    }

    const record = result.rows[0];

    if (record.otp_code !== otp) {
      return { error: "Invalid login code. Please check and try again." };
    }

    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM fluxbase_global.magic_logins WHERE email = $1', [email]);
      return { error: "Login code has expired. Please request a new one." };
    }

    // Valid code! Clean up single-use token
    await pool.query('DELETE FROM fluxbase_global.magic_logins WHERE email = $1', [email]);

    // Find or auto-provision user
    let userResult = await pool.query(
      'SELECT id, display_name, two_factor_enabled FROM fluxbase_global.users WHERE email = $1',
      [email]
    );

    let user;
    if (userResult.rows.length === 0) {
      const userId = crypto.randomUUID();
      const displayName = email.split('@')[0];
      await pool.query(
        'INSERT INTO fluxbase_global.users (id, email, display_name) VALUES ($1::text, $2, $3)',
        [userId, email, displayName]
      );
      user = { id: userId, display_name: displayName, two_factor_enabled: false };
    } else {
      user = userResult.rows[0];
    }

    // Check 2FA
    if (user.two_factor_enabled) {
      return { success: true, requires2FA: true, userId: user.id };
    }

    // Set auth session cookie
    await createSessionCookie(user.id, true);
    return { success: true };
  } catch (error: any) {
    logger.error("Passwordless OTP Verification Error:", error);
    return { error: error.message || "Verification failed" };
  }
}

export async function verify2FALoginAction(userId: string, code: string) {
  if (!userId || !code) return { error: "Missing verification data" };

  try {
    const { getPgPool } = await import('@/lib/pg');
    const { verifyTOTPCode } = await import('@/lib/2fa');
    
    const pool = getPgPool();
    const { rows } = await pool.query(
      'SELECT two_factor_secret, two_factor_enabled FROM fluxbase_global.users WHERE id = $1::text',
      [userId]
    );

    const user = rows[0];
    if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
      return { error: "2FA not properly configured for this user" };
    }

    if (verifyTOTPCode(user.two_factor_secret, code)) {
      await createSessionCookie(userId, true);
      return { success: true };
    } else {
      return { error: "Invalid verification code" };
    }
  } catch (error: any) {
    logger.error("2FA Verification Error:", error);
    return { error: "Verification failed. Please try again." };
  }
}

export async function selectProjectAction(formData: FormData) {
  const project = formData.get("project") as string;
  if (project) {
    (await cookies()).set("selectedProject", project, { path: "/", httpOnly: false });
  } else {
    (await cookies()).set("selectedProject", "", { path: "/", maxAge: 0 });
  }
}

export async function resetPasswordAction(formData: FormData) {
  const email = formData.get("email") as string;
  const token = formData.get("token") as string;
  const password = formData.get("password") as string;

  if (!email || !token || !password) {
    return { error: "Missing required fields." };
  }

  try {
    const pool = getPgPool();
    const tokenResult = await pool.query(
      'SELECT expires_at FROM fluxbase_global.password_resets WHERE email = $1 AND token = $2',
      [email, token]
    );

    if (tokenResult.rows.length === 0) {
      return { error: "Invalid or consumed password reset link. Please generate a new one." };
    }

    const expiresAt = new Date(tokenResult.rows[0].expires_at);
    if (new Date() > expiresAt) {
      await pool.query('DELETE FROM fluxbase_global.password_resets WHERE email = $1', [email]);
      return { error: "Password reset link has expired. Please request a new one." };
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const userResult = await pool.query(
      'UPDATE fluxbase_global.users SET password_hash = $1 WHERE email = $2 RETURNING id',
      [passwordHash, email]
    );

    if (userResult.rows.length === 0) {
      return { error: "User not found. Identity verification failed." };
    }

    // Successfully updated to new password! Clear out the single-use token.
    await pool.query('DELETE FROM fluxbase_global.password_resets WHERE email = $1', [email]);

    // Auto-login flawlessly after the password reset
    const userId = userResult.rows[0].id;
    await createSessionCookie(userId, true);

    return { success: true };
  } catch (error: any) {
    logger.error("Password Reset Confirmation Error:", error);
    return { error: "Failed to reset password. Please try again later." };
  }
}

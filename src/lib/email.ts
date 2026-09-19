import nodemailer from 'nodemailer';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import path from 'path';
import logger from '@/lib/logger';

let _sesClient: SESClient | null = null;
function getSesClient(): SESClient | null {
    const isSesConfigured = process.env.USE_AWS_SES === 'true' || 
        process.env.SMTP_HOST?.includes('amazonses.com') ||
        (process.env.AWS_ACCESS_KEY_ID && !process.env.SMTP_HOST);

    if (isSesConfigured) {
        if (!_sesClient) {
            _sesClient = new SESClient({
                region: process.env.AWS_SES_REGION || process.env.AWS_REGION || 'ap-south-1',
                credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                } : undefined,
            });
        }
        return _sesClient;
    }
    return null;
}

function getTransporter() {
    const host = process.env.SMTP_HOST || '';
    const user = process.env.SMTP_USER || '';
    const isGmail = host === 'smtp.gmail.com' || user.endsWith('@gmail.com');

    if (isGmail) {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        connectionTimeout: 10000, 
        greetingTimeout: 10000,
        socketTimeout: 10000,
    });
}

function htmlToPlainText(html: string): string {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&bull;/g, '•')
        .replace(/&copy;/g, '©')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export async function sendEmail(to: string, subject: string, html: string, attachments?: any[], text?: string) {
    const ses = getSesClient();
    const fromAddress = process.env.SMTP_FROM || 'Fluxbase <support@fluxbasedb.me>';
    const plainText = text || htmlToPlainText(html);

    // 1. AWS SES Dispatch
    if (ses && !attachments?.length) {
        try {
            logger.info(`[Email] Dispatching message to ${to} via AWS SES (ap-south-1)...`);
            const command = new SendEmailCommand({
                Source: fromAddress,
                Destination: { ToAddresses: [to] },
                Message: {
                    Subject: { Data: subject, Charset: 'UTF-8' },
                    Body: {
                        Html: { Data: html, Charset: 'UTF-8' },
                        Text: { Data: plainText, Charset: 'UTF-8' }
                    }
                }
            });
            const result = await ses.send(command);
            logger.info(`[Email] Successfully sent via AWS SES. MessageId: ${result.MessageId}`);
            return { messageId: result.MessageId };
        } catch (sesErr: any) {
            logger.warn('[Email] AWS SES direct send warning, falling back to SMTP transporter:', sesErr?.message || sesErr);
        }
    }

    // 2. SMTP Transporter Dispatch
    if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
        logger.info("SMTP not configured. Skipping email:", { to, subject });
        return;
    }

    try {
        const transporter = getTransporter();
        const fromAddress = process.env.SMTP_FROM || (process.env.SMTP_USER ? `"Fluxbase" <${process.env.SMTP_USER}>` : '"Fluxbase" <noreply@fluxbase.com>');
        const plainText = text || htmlToPlainText(html);

        const info = await transporter.sendMail({
            from: fromAddress,
            to,
            subject,
            text: plainText,
            html,
            attachments,
            headers: {
                'X-Mailer': 'Fluxbase Mail Engine',
                'X-Priority': '3',
            }
        });
        logger.info("Message sent: %s", info.messageId);
        return info;
    } catch (error) {
        logger.error("Error sending email:", error);
        throw error;
    }
}

interface EmailTemplateOptions {
    title: string;
    greeting: string;
    instruction: string;
    contentHtml?: string;
}

function buildEmailHtml(options: EmailTemplateOptions) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${options.title}</title>
        <style>
            /* Reset & Base Styles */
            body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
            img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
            body { margin: 0; padding: 0; width: 100% !important; background-color: #000000; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
            
            /* Typography & Layout */
            .wrapper { width: 100%; background-color: #000000; padding: 40px 0; }
            .content-table { max-width: 600px; width: 100%; margin: 0 auto; background-color: #09090b; border: 1px solid #27272a; border-radius: 24px; overflow: hidden; }
            
            /* Header */
            .header { padding: 48px 40px 32px 40px; text-align: left; }
            .brand-logo { width: 48px; height: 48px; object-fit: contain; border-radius: 12px; background-color: rgba(255, 130, 36, 0.1); padding: 10px; box-sizing: border-box; }
            
            /* Body */
            .body-content { padding: 0 40px; text-align: left; }
            h1 { margin: 0 0 16px 0; font-size: 28px; font-weight: 700; color: #ffffff; line-height: 1.3; font-family: -apple-system, sans-serif; letter-spacing: -0.5px; margin-top: 0; }
            p.greeting { font-size: 18px; color: #e4e4e7; margin: 0 0 24px 0; line-height: 1.6; }
            p.instruction { font-size: 16px; color: #a1a1aa; margin: 0 0 40px 0; line-height: 1.6; }
            
            /* Custom Content Box */
            .custom-wrapper { padding: 0 40px 48px 40px; }
            .custom-box { background: linear-gradient(145deg, rgba(255,130,36,0.1) 0%, rgba(255,130,36,0.02) 100%); border: 1px solid rgba(255, 130, 36, 0.2); border-radius: 16px; padding: 32px; text-align: center; }
            
            /* Button */
            .btn { display: inline-block; background-color: #ff8224; color: #ffffff !important; font-size: 16px; font-weight: 600; text-decoration: none; padding: 16px 32px; border-radius: 8px; letter-spacing: 0.5px; transition: background-color 0.2s; }
            .btn:hover { background-color: #e67520; }

            /* Footer */
            .footer { padding: 32px 40px 40px 40px; background-color: #050505; border-top: 1px solid #18181b; text-align: left; }
            .footer-info { font-size: 14px; color: #71717a; margin: 0 0 16px 0; line-height: 1.5; }
            .footer-legal { font-size: 13px; color: #52525b; margin: 0; }
            
            /* Mobile Adjustments */
            @media screen and (max-width: 600px) {
                .content-table { border-radius: 0; border: none; }
                .header, .body-content, .custom-wrapper, .footer { padding-left: 24px; padding-right: 24px; }
            }
            ${options.contentHtml?.includes('otp-code') ? `
            .otp-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 2.5px; color: #ff8224; margin: 0 0 16px 0; }
            .otp-code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 48px; font-weight: 800; letter-spacing: 12px; color: #ffffff; margin: 0; text-shadow: 0 0 20px rgba(255,130,36,0.3); }
            @media screen and (max-width: 600px) { .otp-code { font-size: 36px; letter-spacing: 8px; } }
            ` : ''}
        </style>
    </head>
    <body leftmargin="0" marginwidth="0" topmargin="0" marginheight="0" offset="0">
        <table align="center" border="0" cellpadding="0" cellspacing="0" class="wrapper">
            <tr>
                <td align="center" valign="top">
                    <!-- Main Content Table -->
                    <table border="0" cellpadding="0" cellspacing="0" class="content-table">
                        
                        <!-- Header -->
                        <tr>
                            <td class="header">
                                <table border="0" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td style="vertical-align:middle; width:44px;">
                                            <img src="cid:fluxbase-favicon" alt="Fluxbase" class="brand-logo" width="40" height="40" style="display:block; width:40px; height:40px; border-radius:10px;" />
                                        </td>
                                        <td style="padding-left:12px; font-size:22px; font-weight:700; color:#ffffff; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing:-0.5px; vertical-align:middle;">
                                            Fluxbase
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        
                        <!-- Body Text -->
                        <tr>
                            <td class="body-content">
                                <h1>${options.title}</h1>
                                <p class="greeting">${options.greeting}</p>
                                <p class="instruction">${options.instruction}</p>
                            </td>
                        </tr>
                        
                        <!-- Custom Display (OTP / Button) -->
                        ${options.contentHtml ? `
                        <tr>
                            <td class="custom-wrapper">
                                <div class="custom-box">
                                    ${options.contentHtml}
                                </div>
                            </td>
                        </tr>` : ''}
                        
                        <!-- Footer -->
                        <tr>
                            <td class="footer">
                                <p class="footer-info">This is an automated message from Fluxbase. For security reasons, do not share sensitive links or codes with anyone. If you did not initiate this request, you can safely ignore this email.</p>
                                <p class="footer-legal">&copy; ${new Date().getFullYear()} Fluxbase Inc. &bull; Secure Systems</p>
                            </td>
                        </tr>
                        
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;
}

// Brand attachments (crisp, high-performance 1.69KB favicon logo for email headers)
function getBrandAttachments() {
    return [{
        filename: 'fluxbase-logo.png',
        path: path.join(process.cwd(), 'public/fluxbase-email-logo.png'),
        cid: 'fluxbase-favicon'
    }];
}

export async function sendOtpEmail(to: string, name: string, otp: string) {
    const safeName = name || 'Developer';
    const html = buildEmailHtml({
        title: "Secure Verification",
        greeting: "Hello " + safeName + ",",
        instruction: "We received a request to authorize a new device for your Fluxbase account. To proceed, please use the secure verification code below.",
        contentHtml: '<p class="otp-label">Authentication Code</p><p class="otp-code">' + otp + '</p>'
    });

    const plainText = `Hello ${safeName},\n\nYour Fluxbase verification code is: ${otp}\n\nThis code will expire in 10 minutes. If you did not initiate this request, please secure your account immediately.\n\nFluxbase Team`;

    return sendEmail(to, otp + " is your Fluxbase verification code", html, getBrandAttachments(), plainText);
}

export async function sendWelcomeEmail(to: string, name: string) {
    const safeName = name || 'Explorer';
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const html = buildEmailHtml({
        title: "Welcome to Fluxbase",
        greeting: "Hello " + safeName + ",",
        instruction: "We're thrilled to have you on board! You're now ready to start accelerating your workflows with the most powerful native database tools available.",
        contentHtml: '<a href="' + url + '/dashboard" class="btn">Open Dashboard</a>'
    });

    const plainText = `Hello ${safeName},\n\nWelcome to Fluxbase!\n\nYou're now ready to start building. Open your dashboard at: ${url}/dashboard\n\nFluxbase Team`;

    return sendEmail(to, "Welcome to Fluxbase", html, getBrandAttachments(), plainText);
}

export async function sendMagicLoginEmail(to: string, name: string, otp: string, magicLink: string) {
    const safeName = name || 'Developer';
    const html = buildEmailHtml({
        title: "Your Login Code & Link",
        greeting: "Hello " + safeName + ",",
        instruction: "You requested a passwordless login to Fluxbase. Enter the 6-digit code below in your browser, or click the direct sign-in button to log in instantly.",
        contentHtml: `
            <div style="margin-bottom: 24px;">
                <p class="otp-label">One-Time Login Code</p>
                <p class="otp-code">${otp}</p>
            </div>
            <div style="margin-bottom: 24px; border-top: 1px solid rgba(255, 130, 36, 0.2); padding-top: 24px;">
                <p style="color: #e4e4e7; font-size: 15px; margin: 0 0 16px 0; font-weight: 500;">Or sign in with 1-click:</p>
                <a href="${magicLink}" class="btn">Sign In Instantly</a>
            </div>
            <p style="color: #a1a1aa; font-size: 13px; margin: 0 0 8px 0;">If the button above doesn't work, copy and paste this secure link:</p>
            <p style="color: #ff8224; font-size: 12px; word-break: break-all; margin: 0;"><a href="${magicLink}" style="color: #ff8224; text-decoration: underline;">${magicLink}</a></p>
        `
    });

    const plainText = `Hello ${safeName},\n\nYour one-time Fluxbase login code is: ${otp}\n\nOr click this link to sign in instantly:\n${magicLink}\n\nThis code and link are valid for 15 minutes.\nIf you did not request this login, you can safely ignore this email.\n\nFluxbase Team`;

    return sendEmail(to, `${otp} is your Fluxbase sign-in code`, html, getBrandAttachments(), plainText);
}

export async function sendPasswordResetEmail(to: string, resetLink: string) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const html = buildEmailHtml({
        title: "Reset Your Password",
        greeting: "Hello,",
        instruction: "We received a request to reset the password for your Fluxbase account. Please click the secure link below to proceed.",
        contentHtml: `
            <div style="margin-bottom: 24px;">
                <a href="${resetLink}" class="btn">Reset Password</a>
            </div>
            <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 16px 0;">If the button above doesn't work, copy and paste this link into your browser:</p>
            <p style="color: #ff8224; font-size: 13px; word-break: break-all; margin: 0 0 24px 0;"><a href="${resetLink}" style="color: #ff8224; text-decoration: underline;">${resetLink}</a></p>
            <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 16px 0;">If you remembered your password, you can simply log in instead:</p>
            <div>
                <a href="${baseUrl}" class="btn" style="background-color: transparent; border: 1px solid #52525b; color: #e4e4e7 !important;">Login to Fluxbase</a>
            </div>
        `
    });

    const plainText = `Hello,\n\nWe received a request to reset the password for your Fluxbase account.\n\nTo reset your password, visit:\n${resetLink}\n\nThis link is valid for 1 hour.\nIf you did not make this request, you can safely ignore this email.\n\nFluxbase Team`;

    return sendEmail(to, "Fluxbase Password Reset", html, getBrandAttachments(), plainText);
}


export async function sendLoginAlertEmail(to: string, name: string) {
    const safeName = name || 'Explorer';
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const html = buildEmailHtml({
        title: "New Login Detected",
        greeting: "Hello " + safeName + ",",
        instruction: "We detected a new login to your Fluxbase account. If this was you, no further action is required.",
        contentHtml: '<p style="color: #a1a1aa; font-size: 14px; margin:0;">If you did not authorize this login, please <a href="' + url + '/settings" style="color: #ff8224; text-decoration: underline;">reset your password</a> immediately.</p>'
    });

    return sendEmail(to, "New login to your Fluxbase account", html, getBrandAttachments());
}

export async function sendLimitAlertEmail(to: string, projectName: string, resource: string, limit: number, isHardLimit: boolean = false) {
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    const title = isHardLimit ? "Resource Limit Exceeded" : "Approaching Resource Limit";
    const instruction = isHardLimit 
        ? `Your project <b>${projectName}</b> has reached its configured limit for <b>${resource}</b> (${limit.toLocaleString()}). Further operations may be blocked until the limit is increased.`
        : `Your project <b>${projectName}</b> is approaching its configured limit for <b>${resource}</b> (${limit.toLocaleString()}).`;

    const html = buildEmailHtml({
        title,
        greeting: "Hello,",
        instruction,
        contentHtml: `
            <div style="margin-bottom: 24px;">
                <p style="color: #e4e4e7; font-size: 16px; margin: 0 0 16px 0;">To ensure uninterrupted service, please review your project's resource limits.</p>
                <a href="${url}/dashboard" class="btn">Manage Limits in Dashboard</a>
            </div>
        `
    });

    return sendEmail(to, `[Fluxbase Alert] ${title} - ${projectName}`, html, getBrandAttachments());
}

/**
 * Sends a branded email report for user feedback.
 */
export async function sendFeedbackEmail(to: string, mood: number | null, message: string, page: string | null, userId: string = 'Anonymous') {
    const moodMap: Record<number, { label: string, color: string }> = {
        1: { label: 'Bad', color: '#f87171' },
        2: { label: 'Okay', color: '#fbbf24' },
        3: { label: 'Good', color: '#34d399' },
        4: { label: 'Love it!', color: '#60a5fa' },
    };

    const moodData = mood ? moodMap[mood] : { label: 'None', color: '#71717a' };
    
    const html = buildEmailHtml({
        title: "New Feedback Received",
        greeting: "Hello, you have received new user feedback.",
        instruction: "Below are the details shared by the user.",
        contentHtml: `
            <div style="text-align: left; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 24px; border: 1px solid #27272a;">
                <p style="margin: 0 0 16px 0; font-size: 14px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">User Identity</p>
                <p style="margin: 0 0 24px 0; font-size: 16px; color: #ffffff; font-family: monospace;">${userId}</p>
                
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Experience Mood</p>
                <p style="margin: 0 0 24px 0; font-size: 18px; font-weight: 700; color: ${moodData.color};">${moodData.label}</p>
                
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Message</p>
                <p style="margin: 0 0 24px 0; font-size: 16px; color: #e4e4e7; line-height: 1.6; white-space: pre-wrap;">${message || 'No written message provided.'}</p>
                
                <p style="margin: 0 0 8px 0; font-size: 14px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Source Page</p>
                <p style="margin: 0; font-size: 13px; color: #a1a1aa; font-family: monospace; word-break: break-all;">${page || 'Unknown'}</p>
            </div>
        `
    });

    return sendEmail(to, `[Fluxbase Feedback] New response from ${userId}`, html, getBrandAttachments());
}

/**
 * Sends a branded email report for user feedback, including AI classification details.
 */
export async function sendClassifiedFeedbackEmail(
    to: string,
    message: string,
    intent: string,
    priority: string,
    intentConfidence: number,
    priorityConfidence: number,
    flagged: boolean,
    userId: string = 'Anonymous',
    mood: number | null = null,
    page: string | null = null
) {
    const moodMap: Record<number, { label: string, color: string }> = {
        1: { label: 'Bad', color: '#f87171' },
        2: { label: 'Okay', color: '#fbbf24' },
        3: { label: 'Good', color: '#34d399' },
        4: { label: 'Love it!', color: '#60a5fa' },
    };

    const moodData = mood ? moodMap[mood] : { label: 'None', color: '#71717a' };
    
    const priorityColors: Record<string, string> = {
        low: '#34d399',      // Emerald
        medium: '#fbbf24',   // Amber
        high: '#f97316',     // Orange
        critical: '#ef4444'  // Red
    };
    const priorityColor = priorityColors[priority.toLowerCase()] || '#71717a';

    const html = buildEmailHtml({
        title: "New Classified Feedback Received",
        greeting: "Hello, a new feedback query has been processed and classified by AI.",
        instruction: "Below are the query details and AI classification results.",
        contentHtml: `
            <div style="text-align: left; background: rgba(255,255,255,0.03); border-radius: 12px; padding: 24px; border: 1px solid #27272a;">
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">User Identity</p>
                <p style="margin: 0 0 20px 0; font-size: 14px; color: #ffffff; font-family: monospace;">${userId}</p>
                
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Experience Mood</p>
                <p style="margin: 0 0 20px 0; font-size: 14px; font-weight: 600; color: ${moodData.color};">${moodData.label}</p>
                
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Feedback Message</p>
                <p style="margin: 0 0 20px 0; font-size: 15px; color: #e4e4e7; line-height: 1.6; white-space: pre-wrap;">${message || 'No written message provided.'}</p>
                
                <hr style="border: 0; border-top: 1px solid #27272a; margin: 20px 0;" />
                
                <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: bold; color: #ff8224; text-transform: uppercase; letter-spacing: 1px;">AI Classification Results</p>
                
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #71717a; width: 40%;">Intent:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: #ffffff; font-weight: 600;">${intent.toUpperCase()} (${(intentConfidence * 100).toFixed(0)}% confidence)</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #71717a;">Priority:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: ${priorityColor}; font-weight: 600;">${priority.toUpperCase()} (${(priorityConfidence * 100).toFixed(0)}% confidence)</td>
                    </tr>
                    <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #71717a;">Flagged Policy Violation:</td>
                        <td style="padding: 6px 0; font-size: 13px; color: ${flagged ? '#ef4444' : '#34d399'}; font-weight: 600;">${flagged ? 'YES' : 'NO'}</td>
                    </tr>
                </table>
                
                <hr style="border: 0; border-top: 1px solid #27272a; margin: 20px 0;" />
                
                <p style="margin: 0 0 4px 0; font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 1px;">Source Page</p>
                <p style="margin: 0; font-size: 12px; color: #a1a1aa; font-family: monospace; word-break: break-all;">${page || 'Unknown'}</p>
            </div>
        `
    });

    return sendEmail(to, `[Fluxbase AI Feedback] [${priority.toUpperCase()}] ${intent.toUpperCase()} from ${userId}`, html, getBrandAttachments());
}

export async function sendTeamInviteEmail(to: string, inviterName: string, projectName: string, role: string) {
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const html = buildEmailHtml({
        title: "You've been invited!",
        greeting: "Hello,",
        instruction: `<b>${inviterName}</b> has invited you to join the team for project <b>${projectName}</b> as a <b>${role}</b>.`,
        contentHtml: `
            <div style="margin-bottom: 24px;">
                <p style="color: #e4e4e7; font-size: 16px; margin: 0 0 24px 0;">Accept the invitation to start collaborating on Fluxbase.</p>
                <a href="${url}/dashboard/projects" class="btn">View Invitation</a>
            </div>
        `
    });

    return sendEmail(to, `${inviterName} invited you to join ${projectName} on Fluxbase`, html, getBrandAttachments());
}

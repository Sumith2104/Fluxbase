import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
    const rawKey = process.env.HOSTING_ENV_ENCRYPTION_KEY || process.env.JWT_SECRET || 'fluxbase-hosting-encryption-key-32b!';
    return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts an environment variable value using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (hex)
 */
export function encryptEnvValue(value: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an environment variable value encrypted with AES-256-GCM.
 */
export function decryptEnvValue(encryptedValue: string): string {
    try {
        const parts = encryptedValue.split(':');
        if (parts.length !== 3) {
            // If not in encrypted format (e.g. legacy plain text), return as-is
            return encryptedValue;
        }

        const [ivHex, authTagHex, cipherTextHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const key = getEncryptionKey();

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch {
        return encryptedValue;
    }
}

/**
 * Parses raw .env file contents into key-value pairs.
 * Ignores empty lines and comments (#).
 * Handles quoted values and automatically marks keys not starting with NEXT_PUBLIC_ or VITE_ as secret.
 */
export function parseEnvFile(content: string): Array<{ key: string; value: string; isSecret: boolean }> {
    const lines = content.split(/\r?\n/);
    const result: Array<{ key: string; value: string; isSecret: boolean }> = [];
    const seenKeys = new Set<string>();

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;

        const key = line.slice(0, eqIdx).trim();
        let value = line.slice(eqIdx + 1).trim();

        // Remove surrounding single or double quotes
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) continue;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const isPublic = key.startsWith('NEXT_PUBLIC_') || key.startsWith('VITE_') || key.startsWith('PUBLIC_');

        result.push({
            key,
            value,
            isSecret: !isPublic,
        });
    }

    return result;
}

/**
 * Injects client-safe runtime environment variables and Flux context into index.html
 */
export function injectEnvIntoHtml(
    html: string,
    publicEnv: Record<string, string>,
    meta: {
        projectId: string;
        siteId: string;
        subdomain: string;
        aiModelsEnabled?: boolean;
    }
): string {
    const clientScript = `
<script id="__FLUX_HOSTING_CONFIG__">
  window.__FLUX_HOSTING__ = {
    projectId: ${JSON.stringify(meta.projectId)},
    siteId: ${JSON.stringify(meta.siteId)},
    subdomain: ${JSON.stringify(meta.subdomain)},
    aiEndpoint: "/api/v1/hosting/ai-proxy",
    aiEnabled: ${Boolean(meta.aiModelsEnabled)},
    env: ${JSON.stringify(publicEnv)}
  };
</script>
`;

    if (html.includes('</head>')) {
        return html.replace('</head>', `${clientScript}\n</head>`);
    } else if (html.includes('<body>')) {
        return html.replace('<body>', `<body>\n${clientScript}`);
    } else {
        return `${clientScript}\n${html}`;
    }
}

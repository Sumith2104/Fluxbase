/**
 * Browser-native Web Crypto API AES-256-GCM End-to-End Encryption
 * Plaintext is encrypted inside the sender's browser before transmission.
 * Plaintext is decrypted inside the recipient's browser after reception.
 * The server only handles base64 ciphertext and initialization vectors.
 */

// Fixed salt for room-based key derivation
const DEFAULT_SALT = new TextEncoder().encode('fluxbase_e2ee_salt_v1_2026');

export async function deriveRoomKey(passphrase: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: DEFAULT_SALT,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptText(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
    const enc = new TextEncoder();
    // 12-byte IV standard for AES-GCM
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(plaintext);

    const ciphertextBuffer = await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv
        },
        key,
        encoded
    );

    // Convert to base64 for wire transmission
    const ciphertextBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));
    const ivBase64 = btoa(String.fromCharCode(...iv));

    return {
        ciphertext: ciphertextBase64,
        iv: ivBase64
    };
}

export async function decryptText(ciphertextBase64: string, ivBase64: string, key: CryptoKey): Promise<string> {
    try {
        const ciphertextBytes = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
        const ivBytes = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));

        const decryptedBuffer = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: ivBytes
            },
            key,
            ciphertextBytes
        );

        return new TextDecoder().decode(decryptedBuffer);
    } catch {
        return '🔒 [Unable to Decrypt: Incorrect Passphrase or Corrupted Ciphertext]';
    }
}

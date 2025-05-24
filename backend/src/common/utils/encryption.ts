import crypto from 'crypto';
import { env } from './envConfig';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

export async function encrypt(data: string | Buffer): Promise<string> {
    try {
        // Generate a random salt
        const salt = crypto.randomBytes(SALT_LENGTH);
        
        // Generate key using PBKDF2
        const key = crypto.pbkdf2Sync(
            env.ENCRYPTION_KEY,
            salt,
            ITERATIONS,
            KEY_LENGTH,
            'sha512'
        );

        // Generate random IV
        const iv = crypto.randomBytes(IV_LENGTH);

        // Create cipher
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        // Encrypt the data
        const dataBuffer = data instanceof Buffer ? data : Buffer.from(data);
        const encrypted = Buffer.concat([
            cipher.update(dataBuffer),
            cipher.final()
        ]);

        // Get auth tag
        const tag = cipher.getAuthTag();

        // Combine all components
        const result = Buffer.concat([
            salt,
            iv,
            tag,
            encrypted
        ]);

        return result.toString('base64');
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt data');
    }
}

export async function decrypt(encryptedData: string): Promise<Buffer> {
    try {
        // Convert from base64
        const buffer = Buffer.from(encryptedData, 'base64');

        // Extract components
        const salt = buffer.subarray(0, SALT_LENGTH);
        const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
        const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
        const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

        // Generate key using PBKDF2
        const key = crypto.pbkdf2Sync(
            env.ENCRYPTION_KEY,
            salt,
            ITERATIONS,
            KEY_LENGTH,
            'sha512'
        );

        // Create decipher
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        // Decrypt
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);

        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt data');
    }
} 
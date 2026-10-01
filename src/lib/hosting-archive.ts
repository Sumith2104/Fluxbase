import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import JSZip from 'jszip';
import logger from '@/lib/logger';

const execAsync = promisify(exec);

/**
 * Packs a directory into a .tar.gz Buffer using native tar or JSZip fallback
 */
export async function createStandaloneArchive(sourceDir: string): Promise<Buffer> {
    const tempArchive = path.join(os.tmpdir(), `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tar.gz`);

    try {
        // Native tar is available on Windows (Windows 10/11) and Linux (EC2)
        await execAsync(`tar -czf "${tempArchive}" -C "${sourceDir}" .`);
        const buffer = await fs.promises.readFile(tempArchive);
        await fs.promises.unlink(tempArchive).catch(() => {});
        return buffer;
    } catch (tarErr: any) {
        logger.warn(`[Archive Engine] Native tar creation failed, falling back to JSZip: ${tarErr?.message}`);

        // JSZip fallback
        const zip = new JSZip();

        async function addFilesRecursively(currentDir: string, zipFolder: JSZip) {
            const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    const subFolder = zipFolder.folder(entry.name);
                    if (subFolder) {
                        await addFilesRecursively(fullPath, subFolder);
                    }
                } else if (entry.isFile()) {
                    const fileContent = await fs.promises.readFile(fullPath);
                    zipFolder.file(entry.name, fileContent);
                }
            }
        }

        await addFilesRecursively(sourceDir, zip);
        return await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
    }
}

/**
 * Extracts a .tar.gz or .zip buffer into destDir
 */
export async function extractStandaloneArchive(archiveBuffer: Buffer, destDir: string): Promise<void> {
    await fs.promises.mkdir(destDir, { recursive: true });

    // Determine if archive is zip or tar.gz (gzip magic bytes: 0x1f, 0x8b)
    const isGzip = archiveBuffer.length > 2 && archiveBuffer[0] === 0x1f && archiveBuffer[1] === 0x8b;

    if (isGzip) {
        const tempArchive = path.join(os.tmpdir(), `extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tar.gz`);
        try {
            await fs.promises.writeFile(tempArchive, archiveBuffer);
            await execAsync(`tar -xzf "${tempArchive}" -C "${destDir}"`);
            await fs.promises.unlink(tempArchive).catch(() => {});
            return;
        } catch (tarErr: any) {
            logger.warn(`[Archive Engine] Native tar extraction failed: ${tarErr?.message}`);
            await fs.promises.unlink(tempArchive).catch(() => {});
        }
    }

    // JSZip extraction fallback
    const zip = await JSZip.loadAsync(archiveBuffer);
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) {
            await fs.promises.mkdir(path.join(destDir, relativePath), { recursive: true });
        } else {
            const content = await zipEntry.async('nodebuffer');
            const targetPath = path.join(destDir, relativePath);
            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.promises.writeFile(targetPath, content);
        }
    }
}

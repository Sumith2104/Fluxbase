import { NextRequest, NextResponse } from 'next/server';
import { getAuthContextFromRequest } from '@/lib/auth';
import { requireWriteScope } from '@/lib/require-scope';
import { getProjectById } from '@/lib/data';
import {
    getOrCreateHostingSite,
    createDeployment,
    extractZipArchive,
    ExtractedFile,
    detectMimeType,
    sanitizePath
} from '@/lib/hosting-engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const auth = await getAuthContextFromRequest(req);
    const scopeErr = requireWriteScope(auth);
    if (scopeErr) return scopeErr;
    if (!auth?.userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const contentType = req.headers.get('content-type') || '';
        let projectId = '';
        let environment: 'preview' | 'production' = 'preview';
        let files: ExtractedFile[] = [];

        let buildCommand: string | undefined;
        let outputDirectory: string | undefined;
        let installCommand: string | undefined;

        if (contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            projectId = (formData.get('projectId') as string) || '';
            const envParam = (formData.get('environment') as string) || 'preview';
            if (envParam === 'production' || envParam === 'preview') {
                environment = envParam;
            }

            buildCommand = (formData.get('buildCommand') as string) || undefined;
            outputDirectory = (formData.get('outputDirectory') as string) || undefined;
            installCommand = (formData.get('installCommand') as string) || undefined;

            const fileField = formData.get('file');
            if (!fileField) {
                // Check if multiple individual files were sent
                const allFiles = formData.getAll('files');
                if (allFiles.length > 0) {
                    for (const f of allFiles) {
                        if (f instanceof File) {
                            const buffer = Buffer.from(await f.arrayBuffer());
                            const relPath = sanitizePath(f.name);
                            files.push({
                                path: relPath,
                                buffer,
                                size: buffer.length,
                                mimeType: detectMimeType(relPath)
                            });
                        }
                    }
                } else {
                    return NextResponse.json({ success: false, error: 'No file or zip archive provided' }, { status: 400 });
                }
            } else if (fileField instanceof File) {
                const buffer = Buffer.from(await fileField.arrayBuffer());
                // If it's a zip file
                if (fileField.name.endsWith('.zip') || buffer.slice(0, 4).toString('hex') === '504b0304') {
                    files = await extractZipArchive(buffer);
                } else {
                    const relPath = sanitizePath(fileField.name);
                    files.push({
                        path: relPath,
                        buffer,
                        size: buffer.length,
                        mimeType: detectMimeType(relPath)
                    });
                }
            }
        } else if (contentType.includes('application/json')) {
            const body = await req.json();
            projectId = body.projectId || '';
            environment = body.environment === 'production' ? 'production' : 'preview';
            buildCommand = body.buildCommand || undefined;
            outputDirectory = body.outputDirectory || undefined;
            installCommand = body.installCommand || undefined;

            if (body.zipBase64) {
                const zipBuf = Buffer.from(body.zipBase64, 'base64');
                files = await extractZipArchive(zipBuf);
            } else if (body.files && typeof body.files === 'object') {
                for (const [filePath, content] of Object.entries(body.files)) {
                    const safe = sanitizePath(filePath);
                    const buf = Buffer.isBuffer(content)
                        ? content
                        : Buffer.from(content as string, typeof content === 'string' && content.startsWith('data:') ? 'base64' : 'utf8');
                    files.push({
                        path: safe,
                        buffer: buf,
                        size: buf.length,
                        mimeType: detectMimeType(safe)
                    });
                }
            }
        }

        if (!projectId) {
            return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 });
        }

        if (files.length === 0) {
            return NextResponse.json({ success: false, error: 'No deployable files found in payload' }, { status: 400 });
        }

        const project = await getProjectById(projectId, auth.userId);
        if (!project) {
            return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
        }

        // Get or create site
        const site = await getOrCreateHostingSite(projectId, auth.userId);

        // Deploy
        const result = await createDeployment({
            siteId: site.site_id,
            projectId,
            userId: auth.userId,
            environment,
            source: 'upload',
            files,
            buildCommand,
            outputDirectory,
            installCommand,
            autoPromote: environment === 'production',
            asyncBuild: true
        });

        return NextResponse.json({
            success: true,
            deployment: result.deployment,
            previewUrl: result.previewUrl,
            liveUrl: result.liveUrl,
            message: `Deployed ${files.length} files successfully.`
        });

    } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Deployment failed' }, { status: 500 });
    }
}

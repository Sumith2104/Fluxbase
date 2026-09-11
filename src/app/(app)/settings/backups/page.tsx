'use client';

import { useState, useEffect, useCallback, useContext } from 'react';
import { ProjectContext } from '@/contexts/project-context';
import { useBackupManager } from '@/contexts/backup-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Archive, Download, Clock, CheckCircle2, AlertCircle, Loader2, HardDrive, RotateCcw, Calendar, Trash2, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

interface Backup {
    id: string;
    label: string;
    type: 'auto' | 'manual';
    status: 'completed' | 'in_progress' | 'failed';
    sizeBytes?: number;
    createdAt: string;
    expiresAt?: string;
}

const formatBytes = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function BackupsPage() {
    const { project: selectedProject } = useContext(ProjectContext);
    const projectId = selectedProject?.project_id || '';
    const { backups: activeBackgroundBackups, startBackgroundBackup } = useBackupManager();

    const isBackingUp = activeBackgroundBackups.some(
        b => b.projectId === projectId && b.status === 'in_progress'
    );

    const [backups, setBackups] = useState<Backup[]>([]);
    const [loading, setLoading] = useState(true);
    const [restoring, setRestoring] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [confirmRestore, setConfirmRestore] = useState<Backup | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Backup | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSuccess, setActionSuccess] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    const extractErrorMessage = (data: any, fallback: string) => {
        if (!data) return fallback;
        if (typeof data.error === 'string') return data.error;
        if (data.error?.message && typeof data.error.message === 'string') return data.error.message;
        if (data.message && typeof data.message === 'string') return data.message;
        return fallback;
    };

    const load = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/backups?projectId=${projectId}`);
            const data = await res.json();
            setBackups(data.backups || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [projectId]);

    useEffect(() => { load(); }, [load]);

    // Refresh backups list when background snapshot completes
    useEffect(() => {
        const handler = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.projectId === projectId) {
                load();
            }
        };
        window.addEventListener('fluxbase:backup-completed', handler);
        return () => window.removeEventListener('fluxbase:backup-completed', handler);
    }, [projectId, load]);

    const handleCreate = async () => {
        if (!projectId) return;
        setActionError(null);
        setActionSuccess(null);
        await startBackgroundBackup(projectId, selectedProject?.display_name);
    };

    const handleRestore = async (backup: Backup) => {
        setRestoring(backup.id);
        setActionError(null);
        setActionSuccess(null);
        try {
            const res = await fetch('/api/backups/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, backupId: backup.id }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(extractErrorMessage(data, 'Restore failed. Please try again.'));
            setConfirmRestore(null);
            setActionSuccess('Database restored successfully from snapshot.');
            load();
        } catch (e: any) {
            setActionError(e.message);
            setConfirmRestore(null);
        } finally { setRestoring(null); }
    };

    const handleDownload = async (backup: Backup) => {
        setDownloading(backup.id);
        setActionError(null);
        try {
            const res = await fetch(`/api/backups?projectId=${projectId}&backupId=${backup.id}`);
            const data = await res.json();
            if (!data.success || !data.backup?.data) throw new Error(extractErrorMessage(data, 'Failed to download backup data.'));

            const jsonStr = JSON.stringify(data.backup.data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_${projectId}_${backup.id.substring(0, 8)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setActionError(e.message);
        } finally {
            setDownloading(null);
        }
    };

    const handleDelete = async (backup: Backup) => {
        setDeleting(backup.id);
        setActionError(null);
        setActionSuccess(null);
        try {
            const res = await fetch(`/api/backups?projectId=${projectId}&backupId=${backup.id}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (!data.success) throw new Error(extractErrorMessage(data, 'Delete failed.'));
            setConfirmDelete(null);
            setActionSuccess('Backup deleted successfully.');
            load();
        } catch (e: any) {
            setActionError(e.message);
            setConfirmDelete(null);
        } finally { setDeleting(null); }
    };

    const statusConfig = {
        completed: { label: 'Complete', icon: CheckCircle2, className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
        in_progress: { label: 'In Progress', icon: Loader2, className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
        failed: { label: 'Failed', icon: AlertCircle, className: 'bg-red-500/10 text-red-400 border-red-500/20' },
    };

    const autoBackups = backups.filter(b => b.type === 'auto');
    const manualBackups = backups.filter(b => b.type === 'manual');

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Archive className="h-6 w-6 text-orange-400" />
                        Backups
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Point-in-time database snapshots with background processing and one-click restore
                    </p>
                </div>
                <Button onClick={handleCreate} disabled={isBackingUp || !selectedProject} className="bg-orange-600 hover:bg-orange-500" id="create-backup">
                    {isBackingUp ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Backing up in background...
                        </>
                    ) : (
                        <>
                            <Download className="h-4 w-4 mr-2" />
                            Create Backup
                        </>
                    )}
                </Button>
            </div>

            {/* Status Messages */}
            {actionError && (
                <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-4 py-3 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{actionError}</span>
                    <button onClick={() => setActionError(null)} className="ml-auto opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
                </div>
            )}
            {actionSuccess && (
                <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-4 py-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{actionSuccess}</span>
                    <button onClick={() => setActionSuccess(null)} className="ml-auto opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
                </div>
            )}

            {!selectedProject ? (
                <Card className="border-dashed border-border">
                    <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                        <Archive className="h-12 w-12 opacity-20" />
                        <p className="text-sm">Please select a project to manage backups.</p>
                    </CardContent>
                </Card>
            ) : (
                <>
                {/* Info cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
                {[
                    { label: 'Total Backups', value: backups.length, icon: Archive, color: 'text-orange-400', bg: 'bg-orange-500/10' },
                    { label: 'Auto Backups', value: autoBackups.length, icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                    { label: 'Total Size', value: formatBytes(backups.reduce((a, b) => a + (b.sizeBytes || 0), 0)), icon: HardDrive, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                ].map(s => (
                    <Card key={s.label} className="border-border">
                        <CardContent className="flex items-center gap-3 pt-4">
                            <div className={cn('p-2 rounded-lg', s.bg)}>
                                <s.icon className={cn('h-5 w-5', s.color)} />
                            </div>
                            <div>
                                <div className="text-xl font-bold">{s.value}</div>
                                <div className="text-xs text-muted-foreground">{s.label}</div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="flex items-center justify-between p-4 rounded-lg border border-border bg-card/60">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-9 w-9 rounded-lg" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-44" />
                                    <Skeleton className="h-3 w-56" />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-8 w-24 rounded" />
                                <Skeleton className="h-8 w-8 rounded" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : backups.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
                        <Archive className="h-12 w-12 text-muted-foreground/30" />
                        <p className="text-lg font-medium">No backups yet</p>
                        <p className="text-sm text-muted-foreground">Create your first manual backup or wait for the next automatic snapshot.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {manualBackups.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Download className="h-3.5 w-3.5" />Manual Backups</h3>
                            <BackupList backups={manualBackups} onRestore={setConfirmRestore} onDelete={setConfirmDelete} onDownload={handleDownload} downloading={downloading} restoring={restoring} deleting={deleting} statusConfig={statusConfig} />
                        </div>
                    )}
                    {autoBackups.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Automatic Backups</h3>
                            <BackupList backups={autoBackups} onRestore={setConfirmRestore} onDelete={setConfirmDelete} onDownload={handleDownload} downloading={downloading} restoring={restoring} deleting={deleting} statusConfig={statusConfig} />
                        </div>
                    )}
                </div>
            )}
            </>
        )}

            {/* Restore Confirm Dialog */}
            <Dialog open={!!confirmRestore} onOpenChange={() => setConfirmRestore(null)}>
                <DialogContent className="bg-card border-border max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-yellow-400">
                            <AlertCircle className="h-4 w-4" />Confirm Restore
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-2 space-y-3">
                        <p className="text-sm text-muted-foreground">
                            This will restore your database to the state at <strong className="text-foreground">{confirmRestore && format(new Date(confirmRestore.createdAt), 'MMM d, yyyy HH:mm')}</strong>.
                        </p>
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-300 flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0 text-yellow-400" />
                            <span>This action is irreversible. All data changes made after this backup snapshot will be replaced.</span>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmRestore(null)}>Cancel</Button>
                        <Button onClick={() => confirmRestore && handleRestore(confirmRestore)}
                            disabled={!!restoring}
                            className="bg-yellow-600 hover:bg-yellow-500 text-black font-semibold" id="confirm-restore">
                            {restoring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                            Restore Backup
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirm Dialog */}
            <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
                <DialogContent className="bg-card border-border max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <Trash2 className="h-4 w-4" />Delete Backup
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-2 space-y-3">
                        <p className="text-sm text-muted-foreground">
                            Are you sure you want to delete the backup <strong className="text-foreground">{confirmDelete?.label}</strong>?
                        </p>
                        <p className="text-xs text-muted-foreground">
                            This will permanently remove the snapshot from our servers. You will not be able to restore from this backup again.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                        <Button onClick={() => confirmDelete && handleDelete(confirmDelete)}
                            disabled={!!deleting}
                            className="bg-destructive hover:bg-red-600" id="confirm-delete">
                            {deleting === confirmDelete?.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Delete Permanently
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function BackupList({ backups, onRestore, onDelete, onDownload, downloading, restoring, deleting, statusConfig }: any) {
    return (
        <div className="space-y-2">
            {backups.map((b: Backup) => {
                const { label, icon: Icon, className } = statusConfig[b.status];
                return (
                    <Card key={b.id} className="border-border group">
                        <CardContent className="flex items-center gap-4 p-4">
                            <div className="p-2 rounded-lg bg-muted shrink-0">
                                <Archive className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-medium text-sm">{b.label}</span>
                                    <Badge variant="outline" className={cn('text-[10px] h-4 px-1.5', className)}>
                                        <Icon className={cn('h-2.5 w-2.5 mr-1', b.status === 'in_progress' && 'animate-spin')} />
                                        {label}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{format(new Date(b.createdAt), 'MMM d, yyyy HH:mm')}</span>
                                    <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{formatBytes(b.sizeBytes)}</span>
                                    {b.expiresAt && <span>Expires {formatDistanceToNow(new Date(b.expiresAt), { addSuffix: true })}</span>}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {b.status === 'completed' && (
                                    <>
                                        <Button variant="outline" size="sm" className="h-8 text-xs border-border/80 hover:border-blue-500/50 hover:text-blue-400 shrink-0"
                                            onClick={() => onDownload?.(b)} disabled={downloading === b.id} id={`download-${b.id}`}>
                                            {downloading === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                                            Download
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-8 text-xs border-border/80 hover:bg-secondary hover:text-foreground shrink-0"
                                            onClick={() => onRestore(b)} disabled={!!restoring || !!deleting} id={`restore-${b.id}`}>
                                            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Restore
                                        </Button>
                                    </>
                                )}
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground/75 hover:text-destructive hover:bg-destructive/10 shrink-0"
                                    onClick={() => onDelete(b)} disabled={!!restoring || !!deleting} id={`delete-${b.id}`}>
                                    {deleting === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}

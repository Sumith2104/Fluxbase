'use client';

import { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProjectContext } from '@/contexts/project-context';
import { useUploadManager } from '@/contexts/upload-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Folder,
    FolderOpen,
    Upload,
    Plus,
    Trash2,
    Copy,
    Check,
    Edit2,
    File,
    Image as ImageIcon,
    FileText,
    FileArchive,
    Loader2,
    HardDrive,
    X,
    Menu,
    Search,
    Download,
    Eye,
    Globe,
    Lock,
    LayoutGrid,
    List as ListIcon,
    MoreVertical,
    CloudUpload,
    ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Sheet as SheetRoot,
    SheetContent,
    SheetTrigger,
} from '@/components/ui/sheet';

interface Bucket {
    id: string;
    name: string;
    is_public: boolean;
    created_at: string;
    total_size?: number;
}

interface StorageFile {
    id: string;
    name: string;
    s3_key: string;
    size: number;
    mime_type: string;
    created_at: string;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(mime: string) {
    if (mime.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-blue-400 shrink-0" />;
    if (mime === 'application/pdf') return <FileText className="h-4 w-4 text-red-400 shrink-0" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar') || mime.includes('gzip')) {
        return <FileArchive className="h-4 w-4 text-yellow-400 shrink-0" />;
    }
    if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript') || mime.includes('sql') || mime.includes('html')) {
        return <FileText className="h-4 w-4 text-emerald-400 shrink-0" />;
    }
    return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export default function StoragePage() {
    const { project } = useContext(ProjectContext);
    const { enqueueUpload } = useUploadManager();
    const queryClient = useQueryClient();

    const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [searchQuery, setSearchQuery] = useState('');
    const [bucketSearchQuery, setBucketSearchQuery] = useState('');

    // Bucket creation modal
    const [isCreateBucketOpen, setIsCreateBucketOpen] = useState(false);
    const [newBucketName, setNewBucketName] = useState('');
    const [isPublicBucket, setIsPublicBucket] = useState(false);
    const [creatingBucket, setCreatingBucket] = useState(false);

    // Bucket renaming & deleting
    const [editingBucket, setEditingBucket] = useState<Bucket | null>(null);
    const [editBucketName, setEditBucketName] = useState('');
    const [updatingBucket, setUpdatingBucket] = useState(false);
    const [bucketToDelete, setBucketToDelete] = useState<Bucket | null>(null);
    const [deletingBucketId, setDeletingBucketId] = useState<string | null>(null);

    // File actions
    const [fileToDelete, setFileToDelete] = useState<StorageFile | null>(null);
    const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
    const [previewFileUrl, setPreviewFileUrl] = useState<{ name: string; url: string; mime: string } | null>(null);

    const [error, setError] = useState<string | null>(null);
    const [isMobileBucketsOpen, setIsMobileBucketsOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const projectId = project?.project_id;

    // Load buckets (Smart Cached)
    const { data: buckets = [], isLoading: loadingBuckets } = useQuery<Bucket[]>({
        queryKey: ['storage-buckets', projectId],
        queryFn: async () => {
            if (!projectId) return [];
            const res = await fetch(`/api/storage/buckets?projectId=${projectId}`);
            const data = await res.json();
            return data.success ? data.buckets : [];
        },
        enabled: !!projectId,
        staleTime: 30 * 1000,
    });

    // Auto-select first bucket if none is selected
    useEffect(() => {
        if (buckets.length > 0 && !selectedBucket) {
            setSelectedBucket(buckets[0]);
        } else if (buckets.length > 0 && selectedBucket) {
            // Keep selected bucket data updated
            const updated = buckets.find(b => b.id === selectedBucket.id);
            if (updated) setSelectedBucket(updated);
        } else if (buckets.length === 0) {
            setSelectedBucket(null);
        }
    }, [buckets, selectedBucket]);

    const totalProjectSize = useMemo(() => {
        return buckets.reduce((acc, b) => acc + (Number(b.total_size) || 0), 0);
    }, [buckets]);

    // Load files in selected bucket
    const { data: files = [], isLoading: loadingFiles } = useQuery<StorageFile[]>({
        queryKey: ['storage-files', projectId, selectedBucket?.id],
        queryFn: async () => {
            if (!projectId || !selectedBucket) return [];
            const res = await fetch(`/api/storage/files?bucketId=${selectedBucket.id}&projectId=${projectId}`);
            const data = await res.json();
            return data.success ? data.files : [];
        },
        enabled: !!projectId && !!selectedBucket,
        staleTime: 15 * 1000,
    });

    const filteredFiles = useMemo(() => {
        if (!searchQuery.trim()) return files;
        const q = searchQuery.toLowerCase();
        return files.filter(f => f.name.toLowerCase().includes(q) || f.mime_type.toLowerCase().includes(q));
    }, [files, searchQuery]);

    const filteredBuckets = useMemo(() => {
        if (!bucketSearchQuery.trim()) return buckets;
        const q = bucketSearchQuery.toLowerCase();
        return buckets.filter(b => b.name.toLowerCase().includes(q));
    }, [buckets, bucketSearchQuery]);

    // Upload files via Global Background Worker
    const uploadFiles = async (selectedFiles: File[]) => {
        if (!projectId || !selectedBucket || selectedFiles.length === 0) return;
        for (const file of selectedFiles) {
            await enqueueUpload(file, selectedBucket.id, projectId);
        }
    };

    const onDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) {
            await uploadFiles(droppedFiles);
        }
    };

    // Create bucket
    const handleCreateBucket = async () => {
        const cleanName = newBucketName.trim().toLowerCase();
        if (!projectId || !cleanName) return;
        setCreatingBucket(true);
        setError(null);
        try {
            const res = await fetch('/api/storage/buckets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, name: cleanName, isPublic: isPublicBucket })
            });
            const data = await res.json();
            if (!data.success) {
                setError(typeof data.error === 'object' ? data.error.message : (data.error || 'Failed to create bucket'));
                return;
            }
            setNewBucketName('');
            setIsPublicBucket(false);
            setIsCreateBucketOpen(false);
            await queryClient.invalidateQueries({ queryKey: ['storage-buckets', projectId] });
            setSelectedBucket(data.bucket);
        } catch (err: any) {
            setError(err.message || 'Error creating bucket');
        } finally {
            setCreatingBucket(false);
        }
    };

    // Rename bucket
    const handleUpdateBucket = async () => {
        if (!projectId || !editingBucket || !editBucketName.trim() || editBucketName === editingBucket.name) {
            setEditingBucket(null);
            return;
        }
        setUpdatingBucket(true);
        setError(null);
        try {
            const res = await fetch('/api/storage/buckets', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId: editingBucket.id, projectId, name: editBucketName.trim().toLowerCase() })
            });
            const data = await res.json();
            if (!data.success) {
                setError(typeof data.error === 'object' ? data.error.message : (data.error || 'Failed to rename bucket'));
                return;
            }
            setEditingBucket(null);
            await queryClient.invalidateQueries({ queryKey: ['storage-buckets', projectId] });
            if (selectedBucket?.id === editingBucket.id) setSelectedBucket(data.bucket);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setUpdatingBucket(false);
        }
    };

    // Delete bucket
    const handleDeleteBucket = async (bucket: Bucket) => {
        if (!projectId) return;
        setDeletingBucketId(bucket.id);
        setError(null);
        try {
            const res = await fetch('/api/storage/buckets', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bucketId: bucket.id, projectId })
            });
            const data = await res.json();
            if (!data.success) {
                setError(typeof data.error === 'object' ? data.error.message : (data.error || 'Failed to delete bucket'));
                return;
            }
            if (selectedBucket?.id === bucket.id) {
                const remaining = buckets.filter(b => b.id !== bucket.id);
                setSelectedBucket(remaining.length > 0 ? remaining[0] : null);
            }
            await queryClient.invalidateQueries({ queryKey: ['storage-buckets', projectId] });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setDeletingBucketId(null);
            setBucketToDelete(null);
        }
    };

    // Delete file
    const handleDeleteFile = async (file: StorageFile) => {
        if (!projectId) return;
        setDeletingFileId(file.id);
        try {
            const res = await fetch('/api/storage/files', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileId: file.id, s3Key: file.s3_key, projectId })
            });
            const data = await res.json();
            if (data.success) {
                queryClient.setQueryData(['storage-files', projectId, selectedBucket?.id], (old: StorageFile[] | undefined) =>
                    old ? old.filter(f => f.id !== file.id) : []
                );
                queryClient.invalidateQueries({ queryKey: ['storage-buckets', projectId] });
            }
        } finally {
            setDeletingFileId(null);
            setFileToDelete(null);
        }
    };

    // Copy signed URL
    const copySignedUrl = async (file: StorageFile) => {
        if (!projectId) return;
        try {
            const res = await fetch(`/api/storage/url?s3Key=${encodeURIComponent(file.s3_key)}&projectId=${projectId}`);
            const data = await res.json();
            if (data.url) {
                await navigator.clipboard.writeText(data.url);
                setCopiedId(file.id);
                setTimeout(() => setCopiedId(null), 2500);
            }
        } catch {}
    };

    // Download file
    const handleDownloadFile = async (file: StorageFile) => {
        if (!projectId) return;
        setDownloadingId(file.id);
        try {
            const res = await fetch(`/api/storage/url?s3Key=${encodeURIComponent(file.s3_key)}&projectId=${projectId}`);
            const data = await res.json();
            if (data.url) {
                const a = document.createElement('a');
                a.href = data.url;
                a.download = file.name;
                a.target = '_blank';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        } catch {} finally {
            setDownloadingId(null);
        }
    };

    // Preview File
    const handlePreviewFile = async (file: StorageFile) => {
        if (!projectId) return;
        try {
            const res = await fetch(`/api/storage/url?s3Key=${encodeURIComponent(file.s3_key)}&projectId=${projectId}`);
            const data = await res.json();
            if (data.url) {
                setPreviewFileUrl({ name: file.name, url: data.url, mime: file.mime_type });
            }
        } catch {}
    };

    if (!projectId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[500px] text-muted-foreground gap-3">
                <HardDrive className="h-12 w-12 opacity-25" />
                <p className="text-lg font-medium">No project selected</p>
                <p className="text-sm">Select a project to manage its S3 storage buckets.</p>
            </div>
        );
    }

    const bucketsSidebarContent = (
        <div className="flex flex-col h-full bg-card/60 border border-border/80 rounded-xl overflow-hidden shadow-sm backdrop-blur-md">
            <div className="p-3.5 border-b border-border/70 flex items-center justify-between gap-2 bg-muted/20">
                <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-orange-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">Buckets</span>
                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">{buckets.length}</Badge>
                </div>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs border-border hover:bg-secondary hover:text-foreground gap-1 font-medium"
                    onClick={() => {
                        setNewBucketName('');
                        setIsCreateBucketOpen(true);
                    }}
                >
                    <Plus className="h-3.5 w-3.5" />
                    <span>New</span>
                </Button>
            </div>

            {buckets.length > 5 && (
                <div className="p-2 border-b border-border/40">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Filter buckets..."
                            value={bucketSearchQuery}
                            onChange={e => setBucketSearchQuery(e.target.value)}
                            className="h-7 pl-8 text-xs bg-background/50 border-border/60"
                        />
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loadingBuckets ? (
                    <div className="space-y-2 p-1">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="p-2.5 rounded-lg border border-border/40 bg-secondary/30 space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Folder className="h-4 w-4 text-orange-400/50" />
                                        <Skeleton className="h-4 w-24" />
                                    </div>
                                    <Skeleton className="h-4 w-10 rounded" />
                                </div>
                                <Skeleton className="h-3 w-28" />
                            </div>
                        ))}
                    </div>
                ) : filteredBuckets.length === 0 ? (
                    <div className="text-center py-10 px-3 text-muted-foreground">
                        <Folder className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p className="text-xs font-medium">No buckets found</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-1">Create your first S3 bucket to start storing files.</p>
                        <Button
                            size="sm"
                            className="mt-3 h-7 text-xs bg-orange-600 hover:bg-orange-500"
                            onClick={() => setIsCreateBucketOpen(true)}
                        >
                            <Plus className="h-3 w-3 mr-1" /> Create Bucket
                        </Button>
                    </div>
                ) : (
                    filteredBuckets.map(bucket => {
                        const isSelected = selectedBucket?.id === bucket.id;
                        return (
                            <div
                                key={bucket.id}
                                onClick={() => {
                                    setSelectedBucket(bucket);
                                    setIsMobileBucketsOpen(false);
                                }}
                                className={cn(
                                    'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-all cursor-pointer group border',
                                    isSelected
                                        ? 'bg-orange-500/10 text-orange-400 border-orange-500/30 font-medium shadow-sm'
                                        : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                )}
                            >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    {isSelected ? (
                                        <FolderOpen className="h-4 w-4 shrink-0 text-orange-400" />
                                    ) : (
                                        <Folder className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />
                                    )}
                                    <div className="flex flex-col min-w-0">
                                        <span className="truncate text-foreground font-medium text-[13px]">{bucket.name}</span>
                                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                                            <span>{formatBytes(Number(bucket.total_size) || 0)}</span>
                                            <span>•</span>
                                            {bucket.is_public ? (
                                                <span className="flex items-center gap-0.5 text-blue-400"><Globe className="h-2.5 w-2.5" /> Public</span>
                                            ) : (
                                                <span className="flex items-center gap-0.5"><Lock className="h-2.5 w-2.5" /> Private</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                                        >
                                            <MoreVertical className="h-3.5 w-3.5" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-36">
                                        <DropdownMenuItem
                                            onClick={e => {
                                                e.stopPropagation();
                                                setEditingBucket(bucket);
                                                setEditBucketName(bucket.name);
                                            }}
                                            className="text-xs"
                                        >
                                            <Edit2 className="h-3.5 w-3.5 mr-2" /> Rename
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={e => {
                                                e.stopPropagation();
                                                setBucketToDelete(bucket);
                                            }}
                                            className="text-xs text-red-400 focus:text-red-400"
                                        >
                                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );

    return (
        <div className="max-w-full space-y-4 overflow-x-hidden pb-12">
            {/* Header & Metrics Strip */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2">
                <div>
                    <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
                        <HardDrive className="h-7 w-7 text-orange-400" />
                        Storage
                    </h1>
                    <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        High-performance object storage backed by AWS S3 with signed instant URLs & private bucket isolation.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <Badge variant="outline" className="bg-orange-500/10 border-orange-500/20 text-orange-400 font-mono text-xs px-3 py-1.5 gap-1.5">
                        <HardDrive className="h-3.5 w-3.5" />
                        Total Project Usage: <strong className="text-white">{formatBytes(totalProjectSize)}</strong>
                    </Badge>
                    {selectedBucket && (
                        <Button
                            className="bg-orange-600 hover:bg-orange-500 text-white font-medium text-xs h-8 px-3.5 gap-1.5 shadow-sm"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <Upload className="h-3.5 w-3.5" />
                            Upload Files
                        </Button>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        multiple
                        onChange={async e => {
                            const selected = Array.from(e.target.files || []);
                            if (selected.length > 0) {
                                await uploadFiles(selected);
                            }
                            e.target.value = '';
                        }}
                    />
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="flex items-center gap-3 bg-destructive/15 border border-destructive/30 text-destructive rounded-lg px-4 py-2.5 text-xs">
                    <X className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{typeof error === 'object' ? (error as any).message || JSON.stringify(error) : error}</span>
                    <button onClick={() => setError(null)} className="ml-auto opacity-70 hover:opacity-100">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* Main Split Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start min-h-[calc(100vh-14rem)]">
                {/* Desktop Left Sidebar: Buckets */}
                <div className="hidden lg:block lg:col-span-3 h-[calc(100vh-14rem)] sticky top-0 self-start">
                    {bucketsSidebarContent}
                </div>

                {/* Mobile Drawer Trigger for Buckets */}
                <div className="lg:hidden w-full">
                    <SheetRoot open={isMobileBucketsOpen} onOpenChange={setIsMobileBucketsOpen}>
                        <SheetTrigger asChild>
                            <Button variant="outline" className="w-full flex justify-between items-center gap-2 bg-card border-border/80 text-xs h-9">
                                <span className="flex items-center gap-2">
                                    <Folder className="h-4 w-4 text-orange-400" />
                                    <span>{selectedBucket ? `Bucket: ${selectedBucket.name}` : 'Select or Create a Bucket'}</span>
                                </span>
                                <Menu className="h-4 w-4 text-muted-foreground" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="p-3 w-80 flex flex-col h-full bg-background border-r">
                            <div className="flex-1 overflow-hidden mt-6">
                                {bucketsSidebarContent}
                            </div>
                        </SheetContent>
                    </SheetRoot>
                </div>

                {/* Right Workspace: File Browser */}
                <div className="lg:col-span-9 h-[calc(100vh-14rem)] flex flex-col">
                    <Card className="flex-1 flex flex-col border-border/80 bg-card/60 backdrop-blur-md overflow-hidden shadow-sm">
                        {/* Bucket Toolbar */}
                        <CardHeader className="py-3 px-4 border-b border-border/70 bg-muted/20 flex flex-row items-center justify-between space-y-0 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                {selectedBucket ? (
                                    <div className="flex items-center gap-2 min-w-0">
                                        <FolderOpen className="h-4 w-4 text-orange-400 shrink-0" />
                                        <span className="font-semibold text-sm text-foreground truncate">{selectedBucket.name}</span>
                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono bg-background/50 border-border/60">
                                            {files.length} file{files.length === 1 ? '' : 's'}
                                        </Badge>
                                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono hidden sm:inline-flex">
                                            {formatBytes(Number(selectedBucket.total_size) || 0)}
                                        </Badge>
                                    </div>
                                ) : (
                                    <span className="text-sm font-semibold text-muted-foreground">Select a Bucket</span>
                                )}
                            </div>

                            {selectedBucket && (
                                <div className="flex items-center gap-2">
                                    <div className="relative w-36 sm:w-52">
                                        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                                        <Input
                                            placeholder="Search files..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            className="h-7 pl-8 text-xs bg-background/60 border-border/60"
                                        />
                                    </div>

                                    <div className="flex items-center border border-border/60 rounded-md bg-background/60 p-0.5">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn('h-6 w-6 rounded-sm', viewMode === 'list' && 'bg-muted text-foreground')}
                                            onClick={() => setViewMode('list')}
                                            title="List View"
                                        >
                                            <ListIcon className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn('h-6 w-6 rounded-sm', viewMode === 'grid' && 'bg-muted text-foreground')}
                                            onClick={() => setViewMode('grid')}
                                            title="Grid View"
                                        >
                                            <LayoutGrid className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardHeader>

                        {/* File Content Body */}
                        <CardContent className="p-0 flex-1 overflow-y-auto relative">
                            {!selectedBucket ? (
                                <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-4">
                                    <div className="p-4 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400">
                                        <CloudUpload className="h-10 w-10" />
                                    </div>
                                    <div className="max-w-md">
                                        <h3 className="text-base font-semibold text-foreground">Welcome to Fluxbase S3 Storage</h3>
                                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                            Create an S3 bucket from the left panel to upload files, generate private 15-minute signed URLs, and stream media to your frontend apps.
                                        </p>
                                    </div>
                                    <Button
                                        className="bg-orange-600 hover:bg-orange-500 text-xs h-8 px-4 font-medium"
                                        onClick={() => setIsCreateBucketOpen(true)}
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Create New Bucket
                                    </Button>
                                </div>
                            ) : (
                                <div
                                    className={cn(
                                        'h-full flex flex-col transition-colors',
                                        dragOver && 'bg-orange-500/5 ring-2 ring-inset ring-orange-500/50'
                                    )}
                                    onDragOver={e => {
                                        e.preventDefault();
                                        setDragOver(true);
                                    }}
                                    onDragLeave={() => setDragOver(false)}
                                    onDrop={onDrop}
                                >
                                    {loadingFiles ? (
                                        viewMode === 'grid' ? (
                                            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                                                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                                    <div key={i} className="p-3 rounded-lg border border-border/50 bg-secondary/20 flex flex-col justify-between space-y-3">
                                                        <Skeleton className="h-24 w-full rounded" />
                                                        <div className="space-y-1.5">
                                                            <Skeleton className="h-3.5 w-3/4" />
                                                            <Skeleton className="h-3 w-1/2" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="p-3 space-y-2">
                                                {[1, 2, 3, 4, 5, 6].map(i => (
                                                    <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-secondary/20">
                                                        <div className="flex items-center gap-3">
                                                            <Skeleton className="h-6 w-6 rounded" />
                                                            <Skeleton className="h-4 w-44" />
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <Skeleton className="h-4 w-16" />
                                                            <Skeleton className="h-6 w-16 rounded" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    ) : files.length === 0 ? (
                                        <div
                                            className="flex flex-col items-center justify-center h-full p-8 text-center gap-3 cursor-pointer hover:bg-muted/10 transition-colors"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <div className="p-4 rounded-2xl bg-muted/40 border border-border/80">
                                                <Upload className="h-8 w-8 text-orange-400/80" />
                                            </div>
                                            <p className="font-semibold text-sm text-foreground">Drag & drop files here, or click to browse</p>
                                            <p className="text-xs text-muted-foreground/80 max-w-sm">
                                                Supports Images, PDFs, Videos, ZIP, CSV, JSON and documents. Files upload seamlessly in the background.
                                            </p>
                                            <Button size="sm" variant="outline" className="h-7 text-xs border-border text-foreground hover:bg-secondary mt-1">
                                                Select Files
                                            </Button>
                                        </div>
                                    ) : filteredFiles.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground text-xs gap-2">
                                            <Search className="h-6 w-6 opacity-30" />
                                            <p>No files matching &quot;{searchQuery}&quot;</p>
                                        </div>
                                    ) : viewMode === 'grid' ? (
                                        /* Grid Cards View */
                                        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                                            {filteredFiles.map(file => (
                                                <Card
                                                    key={file.id}
                                                    className="group border-border/70 bg-card/40 hover:bg-card/90 hover:border-border transition-all overflow-hidden flex flex-col text-xs"
                                                >
                                                    <div
                                                        className="h-28 bg-muted/30 flex items-center justify-center p-2 relative overflow-hidden border-b border-border/40 cursor-pointer"
                                                        onClick={() => {
                                                            if (file.mime_type.startsWith('image/')) handlePreviewFile(file);
                                                            else copySignedUrl(file);
                                                        }}
                                                    >
                                                        {file.mime_type.startsWith('image/') ? (
                                                            <div className="flex flex-col items-center gap-1">
                                                                <ImageIcon className="h-8 w-8 text-blue-400" />
                                                                <span className="text-[10px] text-muted-foreground">Click to Preview</span>
                                                            </div>
                                                        ) : (
                                                            getFileIcon(file.mime_type)
                                                        )}
                                                    </div>
                                                    <CardContent className="p-2.5 flex flex-col gap-1.5 flex-1">
                                                        <span className="font-medium text-foreground truncate" title={file.name}>
                                                            {file.name}
                                                        </span>
                                                        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                                                            <span>{formatBytes(file.size)}</span>
                                                            <span>{file.mime_type.split('/')[1]?.toUpperCase() || 'FILE'}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between pt-1 border-t border-border/40 mt-auto">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                title="Copy signed URL"
                                                                onClick={() => copySignedUrl(file)}
                                                            >
                                                                {copiedId === file.id ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                title="Download file"
                                                                onClick={() => handleDownloadFile(file)}
                                                                disabled={downloadingId === file.id}
                                                            >
                                                                {downloadingId === file.id ? <Loader2 className="h-3 w-3 animate-spin text-orange-400" /> : <Download className="h-3 w-3" />}
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6 hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                                                                title="Delete file"
                                                                onClick={() => setFileToDelete(file)}
                                                                disabled={deletingFileId === file.id}
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    ) : (
                                        /* Table List View */
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs text-left">
                                                <thead>
                                                    <tr className="border-b border-border/70 text-muted-foreground uppercase text-[10px] font-semibold tracking-wider bg-muted/10">
                                                        <th className="px-4 py-2.5">Name</th>
                                                        <th className="px-3 py-2.5">Type</th>
                                                        <th className="px-3 py-2.5">Size</th>
                                                        <th className="px-3 py-2.5">Uploaded</th>
                                                        <th className="px-4 py-2.5 text-right">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border/40">
                                                    {filteredFiles.map(file => (
                                                        <tr key={file.id} className="hover:bg-muted/30 group transition-colors">
                                                            <td className="px-4 py-2.5 font-medium text-foreground">
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    {getFileIcon(file.mime_type)}
                                                                    <span className="truncate max-w-[280px]" title={file.name}>{file.name}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-muted-foreground">
                                                                <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono uppercase bg-background/40">
                                                                    {file.mime_type.split('/')[1]?.slice(0, 8) || 'FILE'}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-muted-foreground font-mono">
                                                                {formatBytes(file.size)}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-muted-foreground font-mono text-[11px]">
                                                                {new Date(file.created_at).toLocaleDateString(undefined, {
                                                                    day: 'numeric',
                                                                    month: 'short',
                                                                    year: 'numeric'
                                                                })}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right">
                                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                    {file.mime_type.startsWith('image/') && (
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            className="h-7 w-7 hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                            title="Preview Image"
                                                                            onClick={() => handlePreviewFile(file)}
                                                                        >
                                                                            <Eye className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    )}
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                        title="Copy Signed 15-Min URL"
                                                                        onClick={() => copySignedUrl(file)}
                                                                    >
                                                                        {copiedId === file.id ? (
                                                                            <Check className="h-3.5 w-3.5 text-green-400" />
                                                                        ) : (
                                                                            <Copy className="h-3.5 w-3.5" />
                                                                        )}
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 hover:bg-muted text-muted-foreground hover:text-foreground"
                                                                        title="Download File"
                                                                        onClick={() => handleDownloadFile(file)}
                                                                        disabled={downloadingId === file.id}
                                                                    >
                                                                        {downloadingId === file.id ? (
                                                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" />
                                                                        ) : (
                                                                            <Download className="h-3.5 w-3.5" />
                                                                        )}
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                                                                        title="Delete file"
                                                                        onClick={() => setFileToDelete(file)}
                                                                        disabled={deletingFileId === file.id}
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Create Bucket Modal */}
            <Dialog open={isCreateBucketOpen} onOpenChange={setIsCreateBucketOpen}>
                <DialogContent className="border-border bg-card max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-foreground">
                            <Folder className="h-5 w-5 text-orange-400" /> Create S3 Bucket
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Buckets are isolated containers for your project&apos;s files and assets.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-foreground">Bucket Name</label>
                            <Input
                                placeholder="e.g. avatars, invoices, user-uploads"
                                value={newBucketName}
                                onChange={e => setNewBucketName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                                className="h-9 text-xs font-mono"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleCreateBucket()}
                            />
                            <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, hyphens and underscores (1-63 chars).</p>
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/20">
                            <div>
                                <p className="text-xs font-medium text-foreground">Public Bucket</p>
                                <p className="text-[11px] text-muted-foreground">Allow public direct access without signing URLs.</p>
                            </div>
                            <input
                                type="checkbox"
                                checked={isPublicBucket}
                                onChange={e => setIsPublicBucket(e.target.checked)}
                                className="h-4 w-4 rounded accent-orange-500 cursor-pointer"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setIsCreateBucketOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="bg-orange-600 hover:bg-orange-500 text-white font-medium"
                            onClick={handleCreateBucket}
                            disabled={creatingBucket || !newBucketName.trim()}
                        >
                            {creatingBucket ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
                            Create Bucket
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Bucket Modal */}
            <Dialog open={!!editingBucket} onOpenChange={() => setEditingBucket(null)}>
                <DialogContent className="border-border bg-card max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-foreground">
                            <Edit2 className="h-4 w-4 text-orange-400" /> Rename Bucket
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-foreground">New Bucket Name</label>
                            <Input
                                value={editBucketName}
                                onChange={e => setEditBucketName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                                className="h-9 text-xs font-mono"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleUpdateBucket()}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setEditingBucket(null)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            className="bg-orange-600 hover:bg-orange-500"
                            onClick={handleUpdateBucket}
                            disabled={updatingBucket || !editBucketName.trim()}
                        >
                            {updatingBucket ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Check className="h-4 w-4 mr-1.5" />}
                            Save Name
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Image Preview Modal */}
            <Dialog open={!!previewFileUrl} onOpenChange={() => setPreviewFileUrl(null)}>
                <DialogContent className="border-border bg-card/95 backdrop-blur-xl max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-medium truncate flex items-center justify-between">
                            <span>{previewFileUrl?.name}</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="py-2 flex justify-center items-center max-h-[70vh] overflow-hidden rounded-lg bg-black/40 border border-border/40">
                        {previewFileUrl?.url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={previewFileUrl.url}
                                alt={previewFileUrl.name}
                                className="max-h-[65vh] max-w-full object-contain"
                            />
                        )}
                    </div>
                    <DialogFooter className="flex justify-between items-center sm:justify-between">
                        <Button variant="outline" size="sm" onClick={() => window.open(previewFileUrl?.url, '_blank')}>
                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Open in New Tab
                        </Button>
                        <Button size="sm" onClick={() => setPreviewFileUrl(null)}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bucket Delete Dialog */}
            <AlertDialog open={!!bucketToDelete} onOpenChange={() => setBucketToDelete(null)}>
                <AlertDialogContent className="border-border bg-card max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-400">Delete Bucket</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs text-muted-foreground">
                            Are you sure you want to delete <strong className="text-white">{bucketToDelete?.name}</strong>? This action is permanent. The bucket must be empty before deletion.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-border text-xs">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs"
                            onClick={() => {
                                if (bucketToDelete) handleDeleteBucket(bucketToDelete);
                            }}
                            disabled={deletingBucketId === bucketToDelete?.id}
                        >
                            {deletingBucketId === bucketToDelete?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                            Delete Bucket
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* File Delete Dialog */}
            <AlertDialog open={!!fileToDelete} onOpenChange={() => setFileToDelete(null)}>
                <AlertDialogContent className="border-border bg-card max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-400">Delete File</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs text-muted-foreground">
                            Are you sure you want to delete <strong className="text-white">{fileToDelete?.name}</strong>? The file will be permanently removed from AWS S3.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-border text-xs">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs"
                            onClick={() => {
                                if (fileToDelete) handleDeleteFile(fileToDelete);
                            }}
                            disabled={deletingFileId === fileToDelete?.id}
                        >
                            {deletingFileId === fileToDelete?.id ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                            Delete File
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

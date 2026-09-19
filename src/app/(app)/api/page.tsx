'use client';

import { useContext, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Copy, Check, Plus, Trash2, Key, Loader2, Shield } from "lucide-react";
import { BackButton } from "@/components/back-button";
import { ProjectContext } from '@/contexts/project-context';
import { getTablesForProject, Table as DbTable } from '@/lib/data';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from '@/hooks/use-toast';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { getApiKeysAction, createApiKeyAction, revokeApiKeyAction } from "@/app/(app)/settings/api-key-actions";
import { type ApiKey } from "@/lib/api-keys";
import { useRouter } from "next/navigation";
import { getUserPlanAction } from '@/app/(app)/settings/actions';

const timezones = Intl.supportedValuesOf('timeZone');

function CopyableField({ label, value }: { label: string, value: string }) {
    const { toast } = useToast();
    const [hasCopied, setHasCopied] = useState(false);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(value);
        setHasCopied(true);
        toast({ title: "Copied!", description: `${label} has been copied to your clipboard.` });
        setTimeout(() => setHasCopied(false), 2000);
    };

    return (
        <div className="flex items-center justify-between rounded-lg border bg-background p-3">
            <div className="flex flex-col">
                <span className="text-sm font-semibold">{label}</span>
                <span className="font-mono text-xs text-muted-foreground">{value}</span>
            </div>
            <Button size="icon" variant="ghost" onClick={copyToClipboard}>
                {hasCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
        </div>
    )
}


export default function ApiPage() {
    const { project: selectedProject } = useContext(ProjectContext);
    const [tables, setTables] = useState<DbTable[]>([]);
    const [loadingTables, setLoadingTables] = useState(true);

    // API Key State
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loadingKeys, setLoadingKeys] = useState(false);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [keyName, setKeyName] = useState("");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [planType, setPlanType] = useState<string | null>(null);
    const { toast } = useToast();

    // Fetch plan on load
    useEffect(() => {
        getUserPlanAction().then(res => {
            if (res.success) setPlanType(res.plan ?? 'free');
        });
    }, []);

    useEffect(() => {
        if (selectedProject) {
            setLoadingTables(true);
            getTablesForProject(selectedProject.project_id)
                .then(setTables)
                .finally(() => setLoadingTables(false));

            // Fetch Keys (strictly scoped to current project and global keys)
            setLoadingKeys(true);
            getApiKeysAction(selectedProject.project_id).then(res => {
                if (res.success && res.data) {
                    const projectKeys = res.data.filter(k => !k.projectId || k.projectId === 'global' || k.projectId === selectedProject.project_id);
                    setKeys(projectKeys);
                }
                setLoadingKeys(false);
            });
        } else {
            setLoadingTables(false);
            setLoadingKeys(false);
        }
    }, [selectedProject]);

    const handleCreateKey = async () => {
        if (!keyName.trim() || !selectedProject) return;
        setLoadingKeys(true);

        const res = await createApiKeyAction(keyName, selectedProject.project_id);
        setLoadingKeys(false);

        if (res.success && res.data) {
            setNewKey(res.data.key);
            setKeys([res.data.apiKeyData, ...keys]);
            setKeyName('');
            toast({ title: "Success", description: "Project API Key generated." });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error || "Failed to generate key." });
        }
    };

    const handleRevokeKey = async (id: string) => {
        const res = await revokeApiKeyAction(id);
        if (res.success) {
            setKeys(keys.filter(k => k.id !== id));
            toast({ title: "Revoked", description: "API Key has been revoked." });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
        }
    };

    const copyToClipboardBasic = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        toast({ title: "Copied!", description: `${label} copied to clipboard.` });
    };


    return (
        <div className="space-y-6 w-full">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between w-full">
                <div className="flex items-center gap-4">
                    <BackButton />
                    <div>
                        <h1 className="text-3xl font-bold">API & Settings</h1>
                        <p className="text-muted-foreground">
                            Manage your API access, keys, and project settings.
                        </p>
                    </div>
                </div>
                {planType && (
                    <span className={`sm:ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${planType === 'max'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : planType === 'pro'
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                : 'bg-secondary text-muted-foreground border-border'
                        }`}>
                        <Shield className="h-3 w-3" />
                        {planType.charAt(0).toUpperCase() + planType.slice(1)} Plan
                    </span>
                )}
            </div>

            {!selectedProject ? (
                <Card>
                    <CardHeader>
                        <CardTitle>No Project Selected</CardTitle>
                        <CardDescription>Please select a project to view its API details.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-48 border-2 border-dashed rounded-lg">
                            <p>Your API information will appear here once you select a project.</p>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* Project ID */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Identity</CardTitle>
                            <CardDescription>Use this ID to authenticate your API requests for the '{selectedProject.display_name}' project.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <CopyableField label="Project ID" value={selectedProject.project_id} />
                        </CardContent>
                    </Card>

                    {/* Project Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Project Settings</CardTitle>
                            <CardDescription>Configure project-wide settings like default timezone.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ProjectSettingsForm project={selectedProject} />
                        </CardContent>
                    </Card>

                    {/* API Keys Section (Migrated) */}
                    <Card>
                        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>API Keys</CardTitle>
                                <CardDescription>Manage access keys scoped specifically to this project.</CardDescription>
                            </div>
                            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button className="w-full sm:w-auto">
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create New Key
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Create Project API Key</DialogTitle>
                                        <DialogDescription>
                                            This key will be automatically scoped to <strong>{selectedProject.display_name}</strong>.
                                        </DialogDescription>
                                    </DialogHeader>
                                    {newKey ? (
                                        <div className="space-y-4">
                                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-md text-yellow-500 text-sm">
                                                Copy this key ONLY once. It will not be shown again.
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 p-2 bg-muted rounded font-mono text-sm break-all">
                                                    {newKey}
                                                </code>
                                                <Button size="icon" onClick={() => copyToClipboardBasic(newKey, "API Key")}>
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                            </div>
                                            <Button className="w-full" onClick={() => { setCreateDialogOpen(false); setNewKey(null); }}>
                                                Done
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid gap-2">
                                                <Label htmlFor="keyName">Key Name</Label>
                                                <Input
                                                    id="keyName"
                                                    placeholder="e.g. Production App, Test Client"
                                                    value={keyName}
                                                    onChange={(e) => setKeyName(e.target.value)}
                                                />
                                            </div>
                                            <div className="grid gap-2">
                                                <Label>Scope</Label>
                                                <Input disabled value={selectedProject.display_name} className="bg-muted" />
                                                <p className="text-xs text-muted-foreground">This key can only access data within this project.</p>
                                            </div>
                                            <Button onClick={handleCreateKey} disabled={loadingKeys || !keyName.trim()} className="w-full">
                                                {loadingKeys && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                Generate Key
                                            </Button>
                                        </div>
                                    )}
                                </DialogContent>
                            </Dialog>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Preview</TableHead>
                                        <TableHead>Created</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingKeys && keys.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                                        </TableRow>
                                    ) : keys.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                                No keys found for this project.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        keys.map((key) => (
                                            <TableRow key={key.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <Key className="h-4 w-4 text-muted-foreground" />
                                                        {key.name}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">{key.preview}</TableCell>
                                                <TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="icon" onClick={() => handleRevokeKey(key.id)} className="text-destructive hover:bg-destructive/10">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* Tables */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Tables</CardTitle>
                            <CardDescription>Available table names within this project.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {loadingTables ? (
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {[1, 2, 3, 4, 5, 6].map(i => (
                                        <Skeleton key={i} className="h-14 w-full rounded-lg" />
                                    ))}
                                </div>
                            ) : tables.length > 0 ? (
                                tables.map(table => (
                                    <CopyableField key={table.table_id} label={table.table_name} value={table.table_name} />
                                ))
                            ) : (
                                <p className="text-sm text-muted-foreground text-center py-4">No tables found in this project yet.</p>
                            )}
                        </CardContent>
                    </Card>


                    {/* Danger Zone */}
                    <div className="border border-destructive/50 rounded-lg p-6 space-y-4 bg-destructive/5">
                        <h3 className="text-xl font-semibold text-destructive flex items-center gap-2">
                            Danger Zone
                        </h3>
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-2">
                                <h4 className="font-medium">Delete Project</h4>
                                <p className="text-sm text-muted-foreground">
                                    Permanently delete this project and all its data. This action cannot be undone.
                                </p>
                                <DeleteProjectDialog project={selectedProject} />
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-medium">Delete Organization</h4>
                                <p className="text-sm text-muted-foreground">
                                    Permanently delete your account and all projects. This action cannot be undone.
                                </p>
                                <DeleteOrgDialog />
                            </div>
                        </div>
                    </div>
                </>
            )
            }
        </div >
    )
}

function DeleteProjectDialog({ project }: { project: any }) {
    const [open, setOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const router = useRouter();

    const handleDelete = async () => {
        if (confirmText !== project.display_name) return;
        setLoading(true);
        const { deleteProjectAction } = await import("@/app/(app)/settings/actions");
        const res = await deleteProjectAction(project.project_id);

        if (res.success) {
            toast({ title: "Project Deleted", description: "The project has been permanently deleted." });
            setOpen(false);
            router.push('/dashboard/projects');
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">Delete Project</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete Project</DialogTitle>
                    <DialogDescription>
                        This will permanently delete <strong>{project.display_name}</strong> and all its tables.
                        <br />
                        Type <strong>{project.display_name}</strong> to confirm.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={project.display_name}
                    />
                    <Button
                        variant="destructive"
                        className="w-full"
                        disabled={confirmText !== project.display_name || loading}
                        onClick={handleDelete}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete Project
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function DeleteOrgDialog() {
    const [open, setOpen] = useState(false);
    const [confirmText, setConfirmText] = useState("");
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const router = useRouter();

    const handleDelete = async () => {
        if (confirmText !== "delete my account") return;
        setLoading(true);
        const { clearOrganizationAction } = await import("@/app/(app)/settings/actions");
        const res = await clearOrganizationAction();

        if (res.success) {
            toast({ title: "Account Deleted", description: "Your organization has been deleted." });
            router.push('/');
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="destructive" className="w-full sm:w-auto">Delete Organization</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete Organization</DialogTitle>
                    <DialogDescription>
                        This will permanently delete your account and <strong>ALL</strong> projects.
                        <br />
                        Type <strong>delete my account</strong> to confirm.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="delete my account"
                    />
                    <Button
                        variant="destructive"
                        className="w-full"
                        disabled={confirmText !== "delete my account" || loading}
                        onClick={handleDelete}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete Organization
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ProjectSettingsForm({ project }: { project: any }) {
    const [timezone, setTimezone] = useState(project.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    // Sync state if project changes
    useEffect(() => {
        if (project?.timezone) {
            setTimezone(project.timezone);
        }
    }, [project.timezone]);

    const handleSave = async () => {
        setLoading(true);
        const { updateProjectSettingsAction } = await import("@/app/(app)/settings/actions");
        const res = await updateProjectSettingsAction(project.project_id, timezone);
        setLoading(false);

        if (res.success) {
            toast({ title: "Settings Saved", description: "Project timezone updated successfully." });
        } else {
            toast({ variant: "destructive", title: "Error", description: res.error });
        }
    };

    return (
        <div className="space-y-4 max-w-sm">
            <div className="grid gap-2">
                <Label htmlFor="timezone">Database Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select a timezone" />
                    </SelectTrigger>
                    <SelectContent>
                        {timezones.map(tz => (
                            <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Default timezone for generated timestamps (e.g., NOW()).</p>
            </div>
            <Button onClick={handleSave} disabled={loading || timezone === project.timezone} className="w-full sm:w-auto">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Settings
            </Button>
        </div>
    );
}


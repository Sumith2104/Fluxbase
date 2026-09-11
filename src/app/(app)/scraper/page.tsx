"use client"

import { useState, useEffect, useContext } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { ProjectContext } from "@/contexts/project-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Loader2, Play, Plus, Settings2, Trash2, ExternalLink, RefreshCw, Cpu, DatabaseZap, Calendar } from "lucide-react"
import { CreateScraperDialog } from "@/components/scrapers/create-scraper-dialog"
import { EditScraperDialog } from "@/components/scrapers/edit-scraper-dialog"
import { ScraperRunsTable } from "@/components/scrapers/scraper-runs-table"
import { formatDistanceToNow } from "date-fns"

interface Scraper {
    id: string;
    table_name: string;
    target_url?: string;
    status?: string;
    created_at?: string;
    [key: string]: any;
}

export default function ScraperDashboard() {
    const searchParams = useSearchParams()
    const projectIdParam = searchParams.get('projectId')
    const { project: contextProject } = useContext(ProjectContext)

    const projectId = projectIdParam || contextProject?.project_id
    const queryClient = useQueryClient()
    const [createOpen, setCreateOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [selectedScraper, setSelectedScraper] = useState<any>(null)

    const [runningId, setRunningId] = useState<string | null>(null)
    const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null)

    const { data: scrapers = [], isLoading: loading } = useQuery<Scraper[]>({
        queryKey: ['scrapers', projectId],
        queryFn: async () => {
            const res = await fetch(`/api/scrapers?projectId=${projectId}`)
            const data = await res.json()
            return data.success ? data.scrapers : []
        },
        enabled: !!projectId,
    })

    useEffect(() => {
        if (!viewingHistoryId && scrapers.length > 0) {
            setViewingHistoryId(scrapers[0].id)
        }
    }, [scrapers, viewingHistoryId])

    const handleRun = async (scraperId: string) => {
        setRunningId(scraperId)
        setViewingHistoryId(scraperId)
        try {
            await fetch(`/api/scrapers/${scraperId}/run`, { method: "POST" })
            await queryClient.invalidateQueries({ queryKey: ['scrapers', projectId] })
        } catch (error) {
            console.error("Error running scraper:", error)
        } finally {
            setRunningId(null)
        }
    }

    const handleDelete = async (scraperId: string) => {
        if (!confirm("Are you sure you want to delete this scraper and all its run history? The tables it created will NOT be deleted.")) return
        try {
            await fetch(`/api/scrapers?id=${scraperId}`, { method: "DELETE" })
            if (viewingHistoryId === scraperId) setViewingHistoryId(null)
            await queryClient.invalidateQueries({ queryKey: ['scrapers', projectId] })
        } catch (error) {
            console.error("Error deleting scraper:", error)
        }
    }

    if (loading) {
        return (
            <div className="w-full py-8 space-y-8 animate-in fade-in duration-300">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border/60 pb-6">
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-4 w-96 max-w-full" />
                    </div>
                    <Skeleton className="h-9 w-32 rounded-full" />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <div className="lg:col-span-8 space-y-4">
                        {[1, 2].map(i => (
                            <Card key={i} className="border-border/80 bg-card/40 p-5 space-y-3">
                                <div className="flex justify-between items-center">
                                    <Skeleton className="h-5 w-36" />
                                    <Skeleton className="h-7 w-20 rounded" />
                                </div>
                                <Skeleton className="h-4 w-64" />
                            </Card>
                        ))}
                    </div>
                    <div className="lg:col-span-4">
                        <Card className="border-border/80 bg-card/40 p-5 space-y-3">
                            <Skeleton className="h-5 w-28" />
                            <Skeleton className="h-32 w-full rounded" />
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    if (!projectId) {
        return <div className="p-8 text-center text-muted-foreground">Select a project to manage Cloud Scrapers.</div>
    }

    return (
        <div className="w-full py-8 space-y-8 animate-in fade-in zoom-in-95 duration-500">

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b pb-6">
                <div>
                    <h1 className="text-4xl font-black tracking-tight flex items-center gap-3">
                        Native Scraper Engine <Badge variant="secondary" className="bg-orange-500/20 text-orange-500 hover:bg-orange-500/20">Beta</Badge>
                    </h1>
                    <p className="text-muted-foreground mt-2 text-lg">Serverlessly fetch, parse, and ingest web data directly into your database using distributed Playwright engines.</p>
                </div>
                <Button onClick={() => setCreateOpen(true)} className="shrink-0 rounded-full font-bold px-6 bg-orange-500 hover:bg-orange-600 text-white">
                    <Plus className="mr-2 h-4 w-4" /> New Scraper
                </Button>
            </div>

            {scrapers.length === 0 ? (
                <Card className="border-dashed border-2 py-12 bg-background/50 backdrop-blur-sm">
                    <CardContent className="flex flex-col items-center justify-center text-center space-y-4">
                        <div className="h-20 w-20 rounded-full bg-orange-500/10 flex items-center justify-center mb-4">
                            <DatabaseZap className="h-10 w-10 text-orange-500" />
                        </div>
                        <h3 className="text-2xl font-bold">No scrapers configured yet</h3>
                        <p className="text-muted-foreground max-w-md">Create your first native scraper to automatically extract structured data from websites and dump it directly into your SQL database.</p>
                        <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-full">
                            Configure Web Scraper
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <div className="lg:col-span-8 flex flex-col gap-6">
                        {scrapers.map((scraper) => {
                            const uniqueId = scraper.id;
                            return (
                                <Card key={uniqueId} className={`overflow-hidden transition-all duration-300 ${viewingHistoryId === uniqueId ? 'ring-2 ring-orange-500 shadow-lg shadow-orange-500/10' : 'hover:border-primary/50 cursor-pointer'}`} onClick={() => setViewingHistoryId(uniqueId)}>
                                    <CardHeader className="flex flex-row items-start justify-between bg-muted/20 pb-4 border-b">
                                        <div>
                                            <CardTitle className="text-xl flex items-center gap-2">
                                                <Cpu className="h-5 w-5 text-orange-500" />
                                                {scraper.table_name}
                                            </CardTitle>
                                            <CardDescription className="flex items-center gap-1 mt-1.5 font-mono text-xs">
                                                <ExternalLink className="h-3 w-3" />
                                                <a href={scraper.url} target="_blank" rel="noreferrer" className="text-orange-500 hover:underline" onClick={(e) => e.stopPropagation()}>
                                                    {scraper.url}
                                                </a>
                                            </CardDescription>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="capitalize text-xs font-mono bg-background flex items-center gap-1.5"><Calendar className="h-3 w-3" /> {scraper.schedule || 'manual'}</Badge>
                                            <Badge variant="secondary" className={`capitalize font-bold border-none ${scraper.status === 'running' ? 'bg-orange-500/20 text-orange-500 animate-pulse' :
                                                scraper.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                                                    'bg-secondary text-muted-foreground'
                                                }`}>
                                                {scraper.status === 'running' ? 'Running...' : scraper.status === 'idle' ? 'Ready' : scraper.status}
                                            </Badge>
                                        </div>
                                    </CardHeader>

                                    <CardContent className="pt-6">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                            <div className="space-y-1 p-3 rounded-lg bg-muted/40 border">
                                                <p className="text-muted-foreground text-xs uppercase font-bold tracking-wider">Rows Extracted</p>
                                                <p className="font-mono text-lg font-medium">Auto-Inferred</p>
                                            </div>
                                            <div className="space-y-1 p-3 rounded-lg bg-muted/40 border">
                                                <p className="text-muted-foreground text-xs uppercase font-bold tracking-wider">Engine</p>
                                                <p className="font-medium text-lg flex items-center gap-1">Playwright</p>
                                            </div>
                                            <div className="space-y-1 p-3 rounded-lg bg-muted/40 border">
                                                <p className="text-muted-foreground text-xs uppercase font-bold tracking-wider">Container</p>
                                                <p className="font-mono text-sm font-medium truncate" title={scraper.selectors.item}>{scraper.selectors.item}</p>
                                            </div>
                                            <div className="space-y-1 p-3 rounded-lg bg-muted/40 border">
                                                <p className="text-muted-foreground text-xs uppercase font-bold tracking-wider">Last Run</p>
                                                <p className="font-medium text-sm mt-1">{scraper.last_run ? formatDistanceToNow(new Date(scraper.last_run), { addSuffix: true }) : 'Never'}</p>
                                            </div>
                                        </div>
                                    </CardContent>

                                    <CardFooter className="bg-muted/10 border-t justify-between pt-4">
                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedScraper(scraper); setEditOpen(true) }}>
                                                <Settings2 className="h-4 w-4 mr-2" /> Configure
                                            </Button>
                                            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); handleDelete(uniqueId) }}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        <Button
                                            className="bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg shadow-md shadow-orange-500/20 transition-all"
                                            onClick={(e) => { e.stopPropagation(); handleRun(uniqueId) }}
                                            disabled={runningId === uniqueId || scraper.status === 'running'}
                                        >
                                            {runningId === uniqueId || scraper.status === 'running' ? (
                                                <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Executing in Cloud</>
                                            ) : (
                                                <><Play className="mr-2 h-4 w-4 fill-current" /> Run Scraper Now</>
                                            )}
                                        </Button>
                                    </CardFooter>
                                </Card>
                            )
                        })}
                    </div>

                    <div className="lg:col-span-4 sticky top-20 h-fit">
                        <Card className="border-border rounded-lg overflow-hidden">
                            <CardHeader className="border-b pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-medium">
                                    <DatabaseZap className="h-4 w-4 text-muted-foreground" />
                                    Execution Telemetry
                                </CardTitle>
                                <CardDescription>Real-time logs for the selected scraper.</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <ScraperRunsTable scraperId={viewingHistoryId} />
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}

            <CreateScraperDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                projectId={projectId}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['scrapers', projectId] })}
            />

            <EditScraperDialog
                scraper={selectedScraper}
                open={editOpen}
                onOpenChange={setEditOpen}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['scrapers', projectId] })}
            />
        </div>
    )
}

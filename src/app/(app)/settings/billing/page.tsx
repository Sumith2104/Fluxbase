'use client';

import { useContext, useState } from 'react';
import { ProjectContext } from '@/contexts/project-context';
import { PaymentsBillsManager } from '@/components/settings/payments-bills-manager';
import { PaygMeterCard } from '@/components/billing/payg-meter-card';
import { ApiBillsManager } from '@/components/settings/api-bills-manager';
import { CreditCard, Receipt, Zap, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function BillingSettingsPage() {
    const { project: selectedProject } = useContext(ProjectContext);
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-5">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-primary" />
                        Billing & Usage
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                        Manage your workspace subscription tier, active resource allocations, and invoice history.
                    </p>
                </div>
                {selectedProject && (
                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs font-mono py-1 px-2.5 bg-muted/30 border-primary/30 text-primary">
                            Project: {selectedProject.display_name}
                        </Badge>
                    </div>
                )}
            </div>

            {/* Navigation Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
                <TabsList className="grid w-full sm:w-[420px] grid-cols-2 bg-secondary/40 border border-border/60">
                    <TabsTrigger value="overview" className="flex items-center gap-2 text-xs font-medium">
                        <CreditCard className="h-3.5 w-3.5" />
                        Workspace & Plan Usage
                    </TabsTrigger>
                    <TabsTrigger value="api-bills" className="flex items-center gap-2 text-xs font-medium">
                        <Receipt className="h-3.5 w-3.5" />
                        API Bills & Model Usage
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6 m-0">
                    {/* 28-Day Pay-As-You-Go Resource Meter */}
                    {selectedProject && (
                        <div className="w-full">
                            <PaygMeterCard projectId={selectedProject.project_id} />
                        </div>
                    )}

                    {/* Tier Plans, Features, & Invoice History */}
                    <div className="w-full">
                        <PaymentsBillsManager />
                    </div>
                </TabsContent>

                <TabsContent value="api-bills" className="space-y-6 m-0">
                    <div className="w-full">
                        <ApiBillsManager projectId={selectedProject?.project_id} />
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

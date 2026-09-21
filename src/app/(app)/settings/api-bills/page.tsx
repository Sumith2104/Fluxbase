'use client';

import { useContext } from 'react';
import { ProjectContext } from '@/contexts/project-context';
import { ApiBillsManager } from '@/components/settings/api-bills-manager';
import { Receipt, CreditCard, Sparkles, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function ApiBillsPage() {
  const { project: selectedProject } = useContext(ProjectContext);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            API Bills & Invoices
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time usage statements, model cost estimations, and itemized inference logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedProject && (
            <Badge variant="outline" className="text-xs font-mono py-1 px-2.5 bg-muted/30 border-primary/30 text-primary">
              Project: {selectedProject.display_name}
            </Badge>
          )}

          <Link
            href="/settings/billing"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors border border-border/60 rounded-md px-2.5 py-1 bg-secondary/30"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Workspace Tier Plans
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Real-time API Bills Manager */}
      <div className="w-full">
        <ApiBillsManager projectId={selectedProject?.project_id} />
      </div>
    </div>
  );
}

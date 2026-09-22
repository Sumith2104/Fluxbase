'use client';

import React, { useState } from 'react';
import { UniversalChartRenderer } from '@/components/analytics/chart-renderer';
import { Button } from '@/components/ui/button';
import { Pin, Check, BarChart2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createWidgetsAction } from '@/app/(app)/analytics/actions';
import { BorderBeam } from '@/components/ui/border-beam';

import { InChatChartData } from '@/lib/chart-tag-parser';

export type { InChatChartData };

export function InChatChart({ chart, projectId }: { chart: InChatChartData; projectId?: string }) {
  const [pinned, setPinned] = useState(false);
  const [pinning, setPinning] = useState(false);
  const { toast } = useToast();

  const targetProjectId = chart.projectId || projectId;

  // Infer xAxisKey and dataKeys if not explicitly supplied
  const firstRow = chart.data?.[0] || {};
  const keys = Object.keys(firstRow);
  const inferredXKey = chart.config?.xAxisKey || chart.xKey || (chart as any).xAxisKey || keys[0] || 'name';
  const rawYKeys = chart.config?.dataKeys?.length
    ? chart.config.dataKeys
    : chart.yKey
      ? [chart.yKey]
      : chart.yKeys?.length
        ? chart.yKeys
        : (chart as any).yAxisKey
          ? [(chart as any).yAxisKey]
          : keys.filter(k => k !== inferredXKey && (typeof firstRow[k] === 'number' || (!isNaN(Number(firstRow[k])) && firstRow[k] !== '')));

  const finalConfig = {
    xAxisKey: inferredXKey,
    dataKeys: rawYKeys.length ? rawYKeys : [keys.find(k => k !== inferredXKey) || 'value']
  };

  const chartData = React.useMemo(() => {
    if (!Array.isArray(chart.data)) return [];
    return chart.data.map(row => {
      if (!row || typeof row !== 'object') return row;
      const cleanRow = { ...row };
      for (const key of finalConfig.dataKeys) {
        if (typeof cleanRow[key] === 'string' && !isNaN(Number(cleanRow[key])) && cleanRow[key].trim() !== '') {
          cleanRow[key] = Number(cleanRow[key]);
        }
      }
      return cleanRow;
    });
  }, [chart.data, finalConfig.dataKeys]);

  const handlePin = async () => {
    if (!targetProjectId) {
      toast({ variant: 'destructive', title: 'No active project to pin widget to.' });
      return;
    }
    if (!chart.query) {
      toast({ title: 'Preview Only', description: 'This chart is generated from chat observation data.' });
      return;
    }

    setPinning(true);
    try {
      await createWidgetsAction(targetProjectId, [
        {
          title: chart.title || 'AI Generated Chart',
          chartType: chart.type || 'bar',
          query: chart.query,
          config: finalConfig
        }
      ]);
      setPinned(true);
      toast({ title: 'Pinned to Dashboard', description: 'Widget added to your Analytics page.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to pin widget', description: e?.message });
    } finally {
      setPinning(false);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-white/10 bg-card/90 overflow-hidden shadow-md">
      <BorderBeam size="sm" colorVariant="ocean" borderRadius={12}>
        <div className="p-3">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <BarChart2 className="size-4 text-cyan-400" />
              <span className="text-xs font-semibold text-foreground truncate max-w-[220px]">
                {chart.title || 'Analytics Visualization'}
              </span>
            </div>

            {targetProjectId && chart.query && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePin}
                disabled={pinned || pinning}
                className="h-6 px-2 text-[10.5px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                title="Add this chart to your Analytics Dashboard"
              >
                {pinned ? (
                  <>
                    <Check className="size-3 text-emerald-400 mr-1" />
                    <span className="text-emerald-400">Pinned</span>
                  </>
                ) : (
                  <>
                    <Pin className="size-3 mr-1" />
                    <span>Pin</span>
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="h-48 w-full">
            <UniversalChartRenderer
              type={chart.type || 'bar'}
              data={chartData}
              config={finalConfig}
            />
          </div>
        </div>
      </BorderBeam>
    </div>
  );
}

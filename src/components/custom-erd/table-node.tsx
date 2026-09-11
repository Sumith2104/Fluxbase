import React, { useRef } from 'react';
import { type Table, type Column } from '@/lib/data';
import { Database, KeyRound, Link2 } from 'lucide-react';

interface TableNodeProps {
  table: Table;
  columns: Column[];
  pks: Set<string>;
  fks: Set<string>;
  x: number;
  y: number;
  width: number;
  onDrag: (dx: number, dy: number) => void;
}

export const TableNode = React.memo(function TableNode({ table, columns, pks, fks, x, y, width, onDrag }: TableNodeProps) {
  const nodeRef = useRef<HTMLDivElement>(null);

  const getLabel = (val: any): string => {
    if (!val) return '';
    if (typeof val !== 'object') return String(val);
    const result = val.value || val.name || val.column || (val.expr?.value) || (val.expr ? getLabel(val.expr) : null) || JSON.stringify(val);
    return result;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // Prevent canvas drag
    let currentX = e.clientX;
    let currentY = e.clientY;
    let rafId: number | null = null;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - currentX;
      const dy = moveEvent.clientY - currentY;
      currentX = moveEvent.clientX;
      currentY = moveEvent.clientY;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        onDrag(dx, dy);
      });
    };

    const handlePointerUp = () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      ref={nodeRef}
      className="erd-node absolute rounded-lg border border-border bg-secondary/85 shadow-2xl font-sans backdrop-blur-xl overflow-hidden ring-1 ring-border/50 hover:ring-white/20 select-none z-10"
      style={{
        transform: `translate3d(${x}px, ${y}px, 0)`,
        width: `${width}px`,
        cursor: 'grab',
        willChange: 'transform',
      }}
      onPointerDown={handlePointerDown}
    >
      {/* Table Header */}
      <div className="bg-secondary/70 p-3 border-b border-border/50 flex items-center justify-between">
        <p className="text-sm font-bold text-foreground flex items-center gap-2">
          <Database className="h-4 w-4 text-orange-500" />
          {table.table_name}
        </p>
        <span className="text-[10px] text-muted-foreground/75 font-mono tracking-wider">{columns.length} COLS</span>
      </div>

      {/* Columns */}
      <div className="p-3 space-y-2">
        {columns.map(col => {
          const label = getLabel(col.column_name);
          const typeLabel = getLabel(col.data_type);
          const isPk = pks.has(label);
          const isFk = fks.has(label);

          return (
            <div key={col.column_id} className="relative flex items-center justify-between text-xs group py-0.5">
              {/* Anchor points for reference (not purely visual, but helpful for logic if needed) */}
              <div
                id={`anchor-left-${table.table_id}-${label}`}
                className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-1 h-1 bg-transparent"
              />
              <div
                id={`anchor-right-${table.table_id}-${label}`}
                className="absolute right-[-12px] top-1/2 -translate-y-1/2 w-1 h-1 bg-transparent"
              />

              <div className="flex items-center gap-2">
                {isPk && <KeyRound className="h-3 w-3 text-yellow-500" />}
                {isFk && <Link2 className="h-3 w-3 text-blue-500" />}
                {!isPk && !isFk && <span className="w-3" />} {/* Spacer */}

                <span className={`${isPk ? 'font-bold text-yellow-500' : isFk ? 'font-medium text-blue-400' : 'text-foreground/85'}`}>
                  {label}
                </span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/55 group-hover:text-muted-foreground transition-colors">
                {typeLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

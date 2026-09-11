'use client';

import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2, Database, ArrowUp, ArrowDown, ArrowUpDown,
  X, Pin, PinOff, ChevronDown, ChevronRight, Copy,
  Undo2, Redo2, Search, Rows3, Rows4, Table2, Bookmark, Braces,
  Check, Key, Calendar, User, Tag, FileText, Sparkles, Hash,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ColumnDef {
  field: string;
  headerName: string;
  width?: number;
  hidden?: boolean;
  dataType?: string;
}

export interface SortState {
  field: string;
  direction: 'asc' | 'desc';
}

export type RowDensity = 'compact' | 'default' | 'comfortable';

interface DataTableProps {
  columns: ColumnDef[];
  rows: any[];
  loading: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  selectionModel?: string[];
  onRowSelectionModelChange?: (selectionModel: string[]) => void;
  sorts?: SortState[];
  onSortsChange?: (sorts: SortState[]) => void;
  onCellSave?: (rowId: string, field: string, value: string) => Promise<void>;
  storageKey?: string;
  totalRowCount?: number;
}

/* ------------------------------------------------------------------ */
/*  Constants / helpers                                                */
/* ------------------------------------------------------------------ */

const NUMERIC_FIELDS = /price|balance|prob|amount|value|conf|fee|cost|pnl|profit|loss|volume|size|weight|percent/i;
const NUMERIC_TYPES = /int|float|numeric|decimal|double|real|money/;

function fmt(value: any, field: string, dtype?: string): string {
  if (value == null) return '';
  const s = String(value);
  const isNumeric = dtype ? NUMERIC_TYPES.test(dtype) : NUMERIC_FIELDS.test(field);
  if (isNumeric) {
    const n = parseFloat(s);
    if (!isNaN(n) && s === String(n)) {
      if (Math.abs(n) < 1 && n !== 0) return n.toFixed(4);
      if (Number.isInteger(n)) return n.toLocaleString();
      return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
  }
  return s;
}

function isJson(s: string) {
  const t = s.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/* ------------------------------------------------------------------ */
/*  JsonTree  (pure, no hooks)                                         */
/* ------------------------------------------------------------------ */

function JsonTree({ data, depth = 0 }: { data: any; depth?: number }) {
  const [open, setOpen] = React.useState(depth < 2);
  const obj = data !== null && typeof data === 'object';
  if (!obj) return <span className="text-foreground/80">{JSON.stringify(data)}</span>;
  const arr = Array.isArray(data);
  const entries = Object.entries(data);
  return (
    <span className="font-mono text-xs">
      <button className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); setOpen(!open); }}>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {arr ? '[' : '{'}
        {!open && <span className="text-primary/70 ml-1">{entries.length} {arr ? 'items' : 'keys'}</span>}
      </button>
      {open && <span className="ml-1">{entries.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && <span className="text-muted-foreground/50">,&nbsp;</span>}
          {!arr && <span className="text-amber-400/80">&quot;{k}&quot;</span>}
          {!arr && <span className="text-muted-foreground/50">:&nbsp;</span>}
          <JsonTree data={v} depth={depth + 1} />
        </span>
      ))}<span className="text-muted-foreground/50">{arr ? ']' : '}'}</span></span>}
    </span>
  );
}

function getFieldIcon(field: string, dataType?: string) {
  const f = field.toLowerCase();
  const d = (dataType || '').toLowerCase();
  if (f === 'id' || f.endsWith('_id') || f.endsWith('id') || d.includes('uuid')) return <Key className="h-3 w-3 text-amber-400" />;
  if (f.includes('user') || f.includes('author') || f.includes('owner') || f.includes('email')) return <User className="h-3 w-3 text-sky-400" />;
  if (f.includes('created') || f.includes('updated') || f.includes('date') || f.includes('time') || d.includes('timestamp')) return <Calendar className="h-3 w-3 text-emerald-400" />;
  if (f.includes('role') || f.includes('status') || f.includes('type') || f.includes('category') || f.includes('state')) return <Tag className="h-3 w-3 text-purple-400" />;
  if (f.includes('content') || f.includes('description') || f.includes('body') || f.includes('message') || f.includes('text')) return <FileText className="h-3 w-3 text-cyan-400" />;
  if (d.includes('json') || f.includes('data') || f.includes('meta')) return <Braces className="h-3 w-3 text-orange-400" />;
  return <Hash className="h-3 w-3 text-muted-foreground/70" />;
}

function getRolePill(val: string) {
  const v = val.toLowerCase().trim();
  if (v === 'user') return 'bg-sky-500/15 text-sky-400 border border-sky-500/30';
  if (v === 'assistant' || v === 'bot') return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
  if (v === 'system') return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
  if (v === 'admin') return 'bg-purple-500/15 text-purple-400 border border-purple-500/30';
  return null;
}

function RowBlockEditor({
  row,
  rowIndex,
  columns,
  onClose,
  onCellSave,
  onCopyJson,
  flash,
}: {
  row: any;
  rowIndex: number;
  columns: ColumnDef[];
  onClose: () => void;
  onCellSave?: (rowId: string, field: string, value: string) => Promise<void>;
  onCopyJson: () => void;
  flash: (msg: string) => void;
}) {
  const rowId = row && (row.id ?? row._id);
  const [drafts, setDrafts] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    columns.forEach(c => {
      init[c.field] = row[c.field] != null ? String(row[c.field]) : '';
    });
    return init;
  });

  const [saving, setSaving] = React.useState(false);
  const [dirtyFields, setDirtyFields] = React.useState<Set<string>>(new Set());

  const handleFieldChange = (field: string, val: string) => {
    setDrafts(prev => ({ ...prev, [field]: val }));
    const orig = row[field] != null ? String(row[field]) : '';
    setDirtyFields(prev => {
      const next = new Set(prev);
      if (val !== orig) next.add(field);
      else next.delete(field);
      return next;
    });
  };

  const handleSaveAll = async () => {
    if (!onCellSave || !rowId || dirtyFields.size === 0) return;
    setSaving(true);
    try {
      for (const field of dirtyFields) {
        await onCellSave(rowId, field, drafts[field] ?? '');
      }
      setDirtyFields(new Set());
      flash('Row saved successfully');
    } catch (err: any) {
      flash('Error saving row: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    const reset: Record<string, string> = {};
    columns.forEach(c => {
      reset[c.field] = row[c.field] != null ? String(row[c.field]) : '';
    });
    setDrafts(reset);
    setDirtyFields(new Set());
  };

  const isParagraphField = (c: ColumnDef) => {
    const f = c.field.toLowerCase();
    const d = (c.dataType || '').toLowerCase();
    const val = drafts[c.field] || '';
    return (
      f.includes('content') ||
      f.includes('description') ||
      f.includes('body') ||
      f.includes('message') ||
      f.includes('prompt') ||
      f.includes('text') ||
      d.includes('text') ||
      d.includes('json') ||
      val.length > 50 ||
      val.includes('\n')
    );
  };

  const paragraphCols = columns.filter(isParagraphField);
  const shortCols = columns.filter(c => !isParagraphField(c));

  return (
    <div
      className="sticky left-0 w-full max-w-[calc(100vw-340px)] h-full p-3.5 flex flex-col justify-between overflow-hidden bg-card/95 backdrop-blur-xl border-t border-b border-border/70 select-text"
      onClick={e => e.stopPropagation()}
    >
      {/* Header bar with actions (Clean, no logos) */}
      <div className="flex items-center justify-between pb-2 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold uppercase text-foreground">
            Row #{rowIndex + 1} Editor
          </span>
          {dirtyFields.size > 0 && (
            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 font-mono text-[10px] border border-amber-500/30">
              {dirtyFields.size} unsaved change{dirtyFields.size > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {dirtyFields.size > 0 && (
            <>
              <button
                className="px-2.5 py-1 rounded bg-primary text-primary-foreground font-mono text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={handleSaveAll}
                disabled={saving || !onCellSave}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="px-2.5 py-1 rounded bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground font-mono text-xs transition-colors"
                onClick={handleDiscard}
                disabled={saving}
              >
                Discard
              </button>
            </>
          )}
          <button
            className="px-2.5 py-1 rounded bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground font-mono text-xs border border-border/50 transition-colors"
            onClick={onCopyJson}
            title="Copy as formatted JSON"
          >
            Copy JSON
          </button>
          <button
            className="px-2 py-1 rounded hover:bg-muted/70 text-muted-foreground hover:text-foreground font-mono text-xs transition-colors"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      {/* Form Fields Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pt-2 space-y-2.5 pr-1">
        {/* Short Fields Row */}
        {shortCols.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
            {shortCols.map(c => {
              const isReadOnly = c.field.toLowerCase() === 'id' || !onCellSave;
              const isFieldDirty = dirtyFields.has(c.field);
              return (
                <div key={c.field} className="flex flex-col gap-1 min-w-0">
                  <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground/80 tracking-wider truncate">
                    {c.headerName}
                  </label>
                  <input
                    type="text"
                    value={drafts[c.field] ?? ''}
                    onChange={e => handleFieldChange(c.field, e.target.value)}
                    readOnly={isReadOnly}
                    className={`h-7 px-2 text-xs font-mono rounded border transition-colors outline-none ${
                      isReadOnly
                        ? 'bg-muted/30 text-muted-foreground border-border/40 cursor-not-allowed'
                        : isFieldDirty
                        ? 'bg-amber-500/5 text-foreground border-amber-500/60 focus:border-amber-500'
                        : 'bg-background text-foreground border-border/70 focus:border-primary'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Paragraph / Long Text Fields */}
        {paragraphCols.map(c => {
          const isFieldDirty = dirtyFields.has(c.field);
          return (
            <div key={c.field} className="flex flex-col gap-1 w-full">
              <label className="text-[10px] font-mono font-bold uppercase text-muted-foreground/80 tracking-wider">
                {c.headerName} (Paragraph)
              </label>
              <textarea
                value={drafts[c.field] ?? ''}
                onChange={e => handleFieldChange(c.field, e.target.value)}
                rows={3}
                readOnly={!onCellSave}
                placeholder={`Enter ${c.headerName}...`}
                className={`w-full p-2 text-xs font-mono rounded border resize-y custom-scrollbar leading-relaxed outline-none transition-colors ${
                  isFieldDirty
                    ? 'bg-amber-500/5 text-foreground border-amber-500/60 focus:border-amber-500'
                    : 'bg-background text-foreground border-border/70 focus:border-primary'
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  UndoStack  (imperative class, not hooks)                            */
/* ------------------------------------------------------------------ */

class UndoStack {
  private stack: { rowId: string; field: string; old: string; val: string }[] = [];
  private ptr = -1;
  push(e: { rowId: string; field: string; old: string; val: string }) {
    this.stack = this.stack.slice(0, this.ptr + 1);
    this.stack.push(e);
    if (this.stack.length > 100) this.stack.shift();
    this.ptr = this.stack.length - 1;
  }
  undo() { return this.ptr >= 0 ? this.stack[this.ptr--] : null; }
  redo() { return this.ptr < this.stack.length - 1 ? this.stack[++this.ptr] : null; }
  canUndo() { return this.ptr >= 0; }
  canRedo() { return this.ptr < this.stack.length - 1; }
}

/* ------------------------------------------------------------------ */
/*  ColQuickFilter  (separate component — own hooks)                   */
/* ------------------------------------------------------------------ */

function ColQuickFilter({ col, onFilter, active }: {
  col: ColumnDef; onFilter: (f: string, v: string) => void; active: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [val, setVal] = React.useState(active);
  const ref = React.useRef<HTMLDivElement>(null);
  const inp = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) setTimeout(() => inp.current?.focus(), 50); }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        className={`absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-muted/80 z-10 transition-colors ${active ? 'text-primary' : 'text-transparent group-hover/hdr:text-muted-foreground/50 hover:!text-primary'}`}
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        title="Quick filter"
      ><Search className="h-3 w-3" /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-52 p-2.5 rounded-xl border bg-card/95 backdrop-blur-xl shadow-xl" onClick={e => e.stopPropagation()}>
          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5">Filter {col.headerName}</div>
          <Input className="h-7 text-xs rounded-lg" placeholder="Contains..." value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { onFilter(col.field, val); setOpen(false); } if (e.key === 'Escape') setOpen(false); }} />
          <div className="flex gap-1 mt-1.5">
            <Button size="sm" variant="outline" className="h-6 text-[10px] flex-1 rounded-lg" onClick={() => { onFilter(col.field, val); setOpen(false); }}>Apply</Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px] flex-1 rounded-lg" onClick={() => { onFilter(col.field, ''); setOpen(false); }}>Clear</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SavedView helpers                                                 */
/* ------------------------------------------------------------------ */

interface SavedView { id: string; name: string; sorts: SortState[]; density: RowDensity; pinnedColumns: string[]; createdAt: number; }
function loadViews(key: string): SavedView[] { try { return JSON.parse(localStorage.getItem('fv_' + key) || '[]'); } catch { return []; } }
function saveViews(key: string, v: SavedView[]) { try { localStorage.setItem('fv_' + key, JSON.stringify(v)); } catch { /* */ } }

/* ------------------------------------------------------------------ */
/*  Density config                                                    */
/* ------------------------------------------------------------------ */

const DENSITY_H: Record<RowDensity, number> = { compact: 28, default: 40, comfortable: 52 };
const DENSITY_CELL: Record<RowDensity, string> = {
  compact: 'px-2 py-0.5 text-xs',
  default: 'px-4 py-2 text-sm',
  comfortable: 'px-4 py-3 text-sm',
};
const DENSITY_HDR: Record<RowDensity, string> = { compact: 'py-2', default: 'py-3.5', comfortable: 'py-4' };

/* ------------------------------------------------------------------ */
/*  Cell  (separate component — own hooks for edit state)               */
/* ------------------------------------------------------------------ */

interface CellProps {
  rowId: string;
  col: ColumnDef;
  colIdx: number;
  value: any;
  displayValue: string;
  isFocused: boolean;
  isDragSelected: boolean;
  isSaving: boolean;
  isSaved: boolean;
  density: RowDensity;
  isJsonCell: boolean;
  jsonExpanded: boolean;
  onToggleJson: () => void;
  onCellSave: (rowId: string, field: string, value: string) => Promise<void>;
  onFocus: (ci: number) => void;
  onCommitStart: () => void;
  onCommitEnd: () => void;
}

function Cell({
  rowId, col, value, displayValue, isFocused, isDragSelected, isSaving, isSaved,
  density, isJsonCell, jsonExpanded, onToggleJson, onCellSave, onFocus, onCommitStart, onCommitEnd,
}: CellProps) {
  const [editing, setEditing] = React.useState(false);
  const [editVal, setEditVal] = React.useState('');
  const inpRef = React.useRef<HTMLInputElement>(null);

  const startEdit = React.useCallback(() => {
    setEditVal(value != null ? String(value) : '');
    setEditing(true);
  }, [value]);

  const commit = React.useCallback(async () => {
 if (!editing) return;
    const newVal = editVal;
    setEditing(false);
    onCommitStart();
    try { await onCellSave(rowId, col.field, newVal); } finally { onCommitEnd(); }
  }, [editing, editVal, rowId, col.field, onCellSave, onCommitStart, onCommitEnd]);

  React.useEffect(() => { if (editing) setTimeout(() => inpRef.current?.focus(), 30); }, [editing]);

  // Focused cell indicator — sync from parent
  const handleFocus = React.useCallback(() => onFocus(0), [onFocus]);

  const copyVal = React.useCallback(() => {
    const t = value != null ? String(value) : '';
    navigator.clipboard.writeText(t).catch(() => {});
  }, [value]);

  if (editing) {
    return (
      <div className="relative flex h-full shrink-0 items-center overflow-hidden">
        <input
          ref={inpRef} value={editVal} onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }}
          onBlur={commit} onClick={e => e.stopPropagation()}
          className="absolute inset-0 w-full h-full px-3 bg-background text-foreground font-mono border-2 border-primary focus:outline-none rounded-none z-30"
          style={{ fontSize: density === 'compact' ? '11px' : '14px' }} autoFocus
        />
      </div>
    );
  }

  const jsonBlock = isJsonCell ? (
    <span className={`${DENSITY_CELL[density]} w-full flex items-center gap-1`}>
      <span className="truncate flex-1 min-w-0 font-mono">{displayValue.slice(0, 60)}{displayValue.length > 60 ? '...' : ''}</span>
      <button className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground/50 hover:text-foreground shrink-0"
        onClick={e => { e.stopPropagation(); onToggleJson(); }} title="Toggle JSON tree">
        <Braces className="h-3 w-3" />
      </button>
      {jsonExpanded && (
        <div className="absolute left-0 top-full mt-1 z-50 w-96 max-h-72 overflow-auto rounded-md border bg-card/95 backdrop-blur-xl shadow-xl p-3"
          onClick={e => e.stopPropagation()}>
          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">JSON Viewer</div>
          <JsonTree data={JSON.parse(String(value))} />
        </div>
      )}
    </span>
  ) : null;

  const savingIndicator = isSaving ? (
    <span className={`flex items-center gap-1.5 w-full ${DENSITY_CELL[density]}`}>
      <Loader2 className="h-3 w-3 animate-spin shrink-0 text-amber-400" />
      <span className="truncate text-foreground/90 font-medium">{displayValue}</span>
    </span>
  ) : null;

  const normalContent = !jsonBlock && !savingIndicator ? (
    <span className={`${DENSITY_CELL[density]} w-full truncate`}>{displayValue || <span className="text-muted-foreground/30 italic">null</span>}</span>
  ) : null;

  return (
    <div
      className={`relative flex h-full min-w-0 items-center overflow-hidden
        ${isDragSelected ? 'bg-primary/8' : ''}
        ${isSaving ? 'border-l-2 border-l-amber-500/70' : ''}
        ${isSaved ? 'border-l-2 border-l-green-500 bg-green-500/5' : ''}
        ${isFocused ? 'outline outline-1 outline-primary/50 outline-offset-[-1px] z-10' : ''}
        cursor-text`}
      style={{ width: `${150}px`, padding: undefined }}
      onDoubleClick={e => { e.stopPropagation(); startEdit(); }}
      onCopy={e => { e.preventDefault(); copyVal(); }}
      onFocus={handleFocus}
      tabIndex={0}
    >
      {jsonBlock || savingIndicator || normalContent}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DataTable (main)                                                   */
/* ------------------------------------------------------------------ */

export function DataTable({
  columns, rows, loading, fetchNextPage, isFetchingNextPage, hasNextPage,
  selectionModel = [], onRowSelectionModelChange, sorts = [], onSortsChange,
  onCellSave, storageKey, totalRowCount,
}: DataTableProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const undoRef = React.useRef(new UndoStack());
  const visibleColumns = columns.filter(c => !c.hidden);
  const lsKey = storageKey || '_default';

  /* ── persisted column widths ── */
  const [colW, setColW] = React.useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('cw_' + lsKey) || '{}'); } catch { return {}; }
  });
  React.useEffect(() => { try { localStorage.setItem('cw_' + lsKey, JSON.stringify(colW)); } catch { /* */ } }, [colW, lsKey]);

  /* ── pinned columns ── */
  const [pinned, setPinned] = React.useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pin_' + lsKey) || '[]'); } catch { return []; }
  });
  React.useEffect(() => { try { localStorage.setItem('pin_' + lsKey, JSON.stringify(pinned)); } catch { /* */ } }, [pinned, lsKey]);

  /* ── density ── */
  const [density, setDensity] = React.useState<RowDensity>(() => {
    try { return (localStorage.getItem('flux_density') as RowDensity) || 'default'; } catch { return 'default'; }
  });
  React.useEffect(() => { try { localStorage.setItem('flux_density', density); } catch { /* */ } }, [density]);

  /* ── editing state (lifted from Cell for undo) ── */
  const [editingCell, setEditingCell] = React.useState<{ rowId: string; field: string } | null>(null);
  const [savingCell, setSavingCell] = React.useState<string | null>(null);
  const [savedCell, setSavedCell] = React.useState<string | null>(null);

  /* ── focused cell ── */
  const [focused, setFocused] = React.useState<{ r: number; c: number } | null>(null);

  /* ── expanded row detail ── */
  const [expandedRow, setExpandedRow] = React.useState<string | null>(null);

  /* ── JSON expanded cells ── */
  const [jsonOpen, setJsonOpen] = React.useState<Set<string>>(new Set());
  const toggleJson = React.useCallback((key: string) => {
    setJsonOpen(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }, []);

  /* ── drag-select ── */
  const [dragSel, setDragSel] = React.useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null);
  const dragging = React.useRef(false);

  /* ── quick filters ── */
  const [qFilters, setQFilters] = React.useState<Record<string, string>>({});
  const handleQFilter = React.useCallback((field: string, value: string) => {
    setQFilters(prev => { const n = { ...prev }; value ? n[field] = value : delete n[field]; return n; });
    window.dispatchEvent(new CustomEvent('flux:quick-filter', { detail: { field, value } }));
  }, []);

  /* ── toast ── */
  const [toast, setToast] = React.useState<string | null>(null);
  const flash = React.useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 1500); }, []);

  /* ── saved views ── */
  const [views, setViews] = React.useState<SavedView[]>(() => loadViews(lsKey));
  const [showViews, setShowViews] = React.useState(false);
  const [viewName, setViewName] = React.useState('');
  const saveView = React.useCallback(() => {
    const name = viewName.trim() || ('View ' + (views.length + 1));
    const v: SavedView = { id: crypto.randomUUID(), name, sorts, density, pinnedColumns: pinned, createdAt: Date.now() };
    const next = [...views, v]; setViews(next); saveViews(lsKey, next); setViewName(''); setShowViews(false);
  }, [viewName, views, sorts, density, pinned, lsKey]);
  const applyView = React.useCallback((v: SavedView) => {
    onSortsChange?.(v.sorts); setDensity(v.density); setPinned(v.pinnedColumns); setShowViews(false);
  }, [onSortsChange]);
  const deleteView = React.useCallback((id: string) => {
    const next = views.filter(v => v.id !== id); setViews(next); saveViews(lsKey, next);
  }, [views, lsKey]);

  /* ── column resize ── */
  const resizing = React.useRef<{ field: string; x0: number; w0: number } | null>(null);
  const didDrag = React.useRef(false);
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const getW = (f: string) => colW[f] || 150;
  const measureText = React.useCallback((t: string, bold = false) => {
    if (!canvas.current) canvas.current = document.createElement('canvas');
    const ctx = canvas.current.getContext('2d')!;
    ctx.font = bold ? 'bold 11px ui-sans-serif,system-ui,sans-serif' : '14px ui-sans-serif,system-ui,sans-serif';
    return ctx.measureText(t).width;
  }, []);
  const autoFit = React.useCallback((e: React.MouseEvent, field: string) => {
    e.stopPropagation(); e.preventDefault();
    let max = measureText(field.toUpperCase(), true) + 48;
    rows.forEach(r => { const w = measureText(r[field] != null ? String(r[field]) : '') + 48; if (w > max) max = w; });
    setColW(p => ({ ...p, [field]: Math.min(500, Math.max(80, Math.ceil(max))) }));
  }, [rows, measureText]);
  const onResizeStart = React.useCallback((e: React.MouseEvent, field: string) => {
    e.stopPropagation(); e.preventDefault();
    resizing.current = { field, x0: e.clientX, w0: getW(field) }; didDrag.current = false;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
  }, []);
  const onResizeMove = React.useCallback((e: MouseEvent) => {
    const r = resizing.current; if (!r) return;
    const d = e.clientX - r.x0; if (Math.abs(d) > 3) didDrag.current = true;
    setColW(p => ({ ...p, [r.field]: Math.max(50, r.w0 + d) }));
  }, []);
  const onResizeEnd = React.useCallback(() => {
    resizing.current = null;
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
  }, [onResizeMove]);

  /* ── sort ── */
  const handleSort = React.useCallback((e: React.MouseEvent, field: string) => {
    if (!onSortsChange) return;
    const multi = e.shiftKey;
    const ex = sorts.find(s => s.field === field);
    if (multi) {
      if (!ex) onSortsChange([...sorts, { field, direction: 'asc' }]);
      else if (ex.direction === 'asc') onSortsChange(sorts.map(s => s.field === field ? { ...s, direction: 'desc' } : s));
      else onSortsChange(sorts.filter(s => s.field !== field));
    } else {
      if (!ex) onSortsChange([{ field, direction: 'asc' }]);
      else if (ex.direction === 'asc') onSortsChange([{ field, direction: 'desc' }]);
      else onSortsChange([]);
    }
  }, [sorts, onSortsChange]);
  const sortIcon = (field: string) => {
    const s = sorts.find(s => s.field === field); const i = sorts.indexOf(s!);
    if (!s) return <ArrowUpDown className="h-3 w-3 opacity-30 group-hover/hdr:opacity-70 shrink-0" />;
    return <span className="flex items-center gap-0.5 text-primary shrink-0">{s.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{sorts.length > 1 && <span className="text-[9px] font-bold ml-0.5 opacity-80">{i + 1}</span>}</span>;
  };

  /* ── cell save + undo ── */
  const handleCellSave = React.useCallback(async (rowId: string, field: string, value: string) => {
    const old = rows.find(r => (r.id ?? r._id) === rowId)?.[field];
    setSavingCell(rowId + ':' + field);
    try {
      await onCellSave?.(rowId, field, value);
      undoRef.current.push({ rowId, field, old: String(old ?? ''), val: value });
      setSavedCell(rowId + ':' + field); setTimeout(() => setSavedCell(null), 1200);
    } finally { setSavingCell(null); }
  }, [onCellSave, rows]);
  const handleUndo = React.useCallback(async () => {
    const e = undoRef.current.undo(); if (!e || !onCellSave) return;
    await onCellSave(e.rowId, e.field, e.old); flash('Undo: ' + e.field);
  }, [onCellSave, flash]);
  const handleRedo = React.useCallback(async () => {
    const e = undoRef.current.redo(); if (!e || !onCellSave) return;
    await onCellSave(e.rowId, e.field, e.val); flash('Redo: ' + e.field);
  }, [onCellSave, flash]);
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocused(null);
        setEditingCell(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [handleUndo, handleRedo]);

  React.useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (parentRef.current && !parentRef.current.contains(e.target as Node)) {
        setFocused(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  /* ── keyboard nav ── */
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (!focused) return;
    const { r, c: ci } = focused;
    const maxR = rows.length - 1; const maxC = visibleColumns.length - 1;
    let nr = r, nc = ci, handled = false;
    if (e.key === 'ArrowDown') { nr = Math.min(r + 1, maxR); handled = true; }
    else if (e.key === 'ArrowUp') { nr = Math.max(r - 1, 0); handled = true; }
    else if (e.key === 'ArrowRight' || e.key === 'Tab') { e.preventDefault(); nc = Math.min(ci + 1, maxC); handled = true; }
    else if (e.key === 'ArrowLeft') { nc = Math.max(ci - 1, 0); handled = true; }
    else if (e.key === 'Enter' && onCellSave && rows[r]) {
      const row = rows[r]; const field = visibleColumns[ci].field;
      const val = row[field];
      setEditingCell({ rowId: row.id ?? row._id, field });
      // Cell component will pick up editingCell and start editing
      handled = true;
    }
    else if (e.key === 'Escape') { setFocused(null); onRowSelectionModelChange?.([]); handled = true; }
    if (handled) { e.preventDefault(); setFocused({ r: nr, c: nc }); }
  }, [focused, rows, visibleColumns, onCellSave, onRowSelectionModelChange]);

  /* ── drag-select copy ── */
  const inDrag = React.useCallback((r: number, c: number) => {
    if (!dragSel) return false;
    return r >= Math.min(dragSel.r1, dragSel.r2) && r <= Math.max(dragSel.r1, dragSel.r2)
        && c >= Math.min(dragSel.c1, dragSel.c2) && c <= Math.max(dragSel.c1, dragSel.c2);
  }, [dragSel]);
  const copyDrag = React.useCallback(() => {
    if (!dragSel) return;
    const r1 = Math.min(dragSel.r1, dragSel.r2), r2 = Math.max(dragSel.r1, dragSel.r2);
    const c1 = Math.min(dragSel.c1, dragSel.c2), c2 = Math.max(dragSel.c1, dragSel.c2);
    const cols = visibleColumns.slice(c1, c2 + 1);
    const tsv = rows.slice(r1, r2 + 1).map(row => cols.map(c => row[c.field] != null ? String(row[c.field]) : '').join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).then(() => flash(`Copied ${r2 - r1 + 1} x ${c2 - c1 + 1} cells`)).catch(() => {});
    setDragSel(null);
  }, [dragSel, rows, visibleColumns, flash]);
  React.useEffect(() => {
    if (!dragSel) return;
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); copyDrag(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [dragSel, copyDrag]);
  React.useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up);
  }, []);

  /* ── selection helpers ── */
  const toggleSel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRowSelectionModelChange) return;
    onRowSelectionModelChange(selectionModel.includes(id) ? selectionModel.filter(s => s !== id) : [...selectionModel, id]);
  };
  const selectionSet = React.useMemo(() => new Set(selectionModel), [selectionModel]);

  const toggleAll = () => {
    if (!onRowSelectionModelChange) return;
    onRowSelectionModelChange(selectionModel.length === rows.length && rows.length > 0 ? [] : rows.map(r => r.id ?? r._id));
  };

  /* ── virtualizer ── */
  const EXPAND_HEIGHT = 220;
  const count = hasNextPage ? rows.length + 1 : rows.length;
  const rowV = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      const rowId = row && (row.id ?? row._id);
      return (rowId && rowId === expandedRow) ? DENSITY_H[density] + EXPAND_HEIGHT : DENSITY_H[density];
    },
    overscan: 8,
  });
  React.useEffect(() => {
    rowV.measure();
  }, [density, expandedRow]);

  const vItems = rowV.getVirtualItems();
  const lastVirtualItem = vItems.length > 0 ? vItems[vItems.length - 1] : null;

  // Track the row count for which fetchNextPage has already been dispatched to prevent duplicate calls
  const lastPrefetchedLengthRef = React.useRef<number>(0);
  const isFetchingLockRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    if (!isFetchingNextPage) {
      isFetchingLockRef.current = false;
    }
  }, [isFetchingNextPage]);

  // Proactively fetch next 50 rows when user reaches the 35th row of each 50-row batch
  // (Leaving a 15-row buffer so next batch arrives in background before hitting the bottom)
  React.useEffect(() => {
    if (!lastVirtualItem || !hasNextPage || isFetchingNextPage || isFetchingLockRef.current) return;

    // Guard: Prevent calling fetchNextPage multiple times for the same batch of rows
    if (lastPrefetchedLengthRef.current === rows.length) return;

    // Guard against firing on initial page mount before user has even scrolled:
    // Only trigger if rows > 50 OR user has actually scrolled down in the container
    const scrollTop = parentRef.current?.scrollTop || 0;
    if (rows.length <= 50 && scrollTop < 20) return;

    const triggerIndex = Math.max(34, rows.length - 16);
    if (lastVirtualItem.index >= triggerIndex && fetchNextPage) {
      isFetchingLockRef.current = true;
      lastPrefetchedLengthRef.current = rows.length;
      fetchNextPage();
    }
  }, [lastVirtualItem?.index, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  /* ════════════════════════ RENDER ════════════════════════ */

  /* total column width for row constraining */
  const fixedColsW = 40 + 40 + 28; // # (40px) + checkbox (40px) + expand (28px) = 108px
  const dataColsW = visibleColumns.reduce((s, c) => s + getW(c.field), 0);
  const totalW = fixedColsW + dataColsW;
  const gridCols = ['40px','40px','28px',...visibleColumns.map(c=>getW(c.field)+'px')].join(' ');

  return (
    <div className="relative flex flex-col h-full min-h-[200px] w-full max-w-full flex-1 overflow-hidden rounded-xl border border-border/60 bg-card text-foreground shadow-2xl">

      {/* ── Scrollable area ── */}
      <div ref={parentRef} className="flex-1 overflow-auto relative custom-scrollbar" data-scroll-container="true" tabIndex={0} onKeyDown={handleKeyDown}>

        {/* ── Sticky header ── */}
        <div className="sticky top-0 z-20 grid border-b border-border bg-secondary text-xs font-bold uppercase tracking-widest text-muted-foreground shadow-sm" style={{ gridTemplateColumns: gridCols, width: `${totalW}px`, minWidth: '100%' }}>
          <div className={`flex w-10 shrink-0 items-center justify-center border-r border-border/60 bg-muted/50 ${DENSITY_HDR[density]}`}><span className="text-[10px]">#</span></div>
          <div className={`flex w-10 shrink-0 items-center justify-center border-r border-border/60 bg-secondary ${DENSITY_HDR[density]}`}><Checkbox checked={selectionModel.length === rows.length && rows.length > 0} onCheckedChange={toggleAll} /></div>
          <div className={`flex w-7 shrink-0 items-center justify-center border-r border-border/40 bg-secondary ${DENSITY_HDR[density]}`} />

          {visibleColumns.map((c, i) => {
            const sorted = sorts.some(s => s.field === c.field);
            const isPinned = pinned.includes(c.field);
            return (
              <div key={c.field}
                className={`group/hdr relative flex shrink-0 items-center gap-1.5 overflow-hidden bg-secondary px-4 ${DENSITY_HDR[density]} ${i < visibleColumns.length - 1 ? 'border-r border-border/60' : ''} ${onSortsChange ? 'cursor-pointer select-none hover:bg-muted/60 transition-colors' : ''} ${sorted ? 'text-primary bg-primary/5' : ''} ${isPinned ? 'border-l-2 border-l-primary/40' : ''}`}
                
                onClick={e => handleSort(e, c.field)}>
                <span 
                  className="truncate flex-1 min-w-0 font-medium"
                  title={`${c.headerName}${c.dataType ? ` (${c.dataType})` : ''} — Click to sort`}
                >
                  {c.headerName}
                </span>
                {onSortsChange && sortIcon(c.field)}
                <button className={`p-0.5 rounded transition-colors ${isPinned ? 'text-primary' : 'text-transparent group-hover/hdr:text-muted-foreground/50 hover:!text-primary'}`}
                  onClick={e => { e.stopPropagation(); setPinned(p => p.includes(c.field) ? p.filter(f => f !== c.field) : [...p, c.field]); }}
                  title={isPinned ? 'Unpin' : 'Pin'}>
                  {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                </button>
                {onCellSave && <ColQuickFilter col={c} onFilter={handleQFilter} active={qFilters[c.field] || ''} />}
                <div className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-10 -mr-1.5 group/handle flex items-center justify-center"
                  onMouseDown={e => onResizeStart(e, c.field)} onDoubleClick={e => autoFit(e, c.field)}
                  title="Drag to resize / Double-click to auto-fit">
                  <div className="h-4 w-px bg-border transition-all duration-100 group-hover/handle:h-full group-hover/handle:w-0.5 group-hover/handle:bg-primary/70" />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Virtual rows ── */}
        <div style={{ height: rowV.getTotalSize() + 'px', width: `${totalW}px`, minWidth: '100%', position: 'relative' }}>
          {vItems.map(vRow => {
            const isLoader = vRow.index > rows.length - 1;
            const row = rows[vRow.index];
            const rowId = row && (row.id ?? row._id);
            const isSel = row && selectionSet.has(rowId);
            const isExp = rowId === expandedRow;

            return (
              <div
                key={vRow.index}
                data-row-idx={vRow.index}
                className={`absolute top-0 left-0 flex flex-col border-b border-border/30 ${isSel ? 'bg-primary/10' : 'hover:bg-secondary/40'} ${focused?.r === vRow.index ? 'ring-1 ring-inset ring-primary/30' : ''}`}
                style={{
                  height: vRow.size + 'px',
                  width: `${totalW}px`,
                  minWidth: '100%',
                  transform: `translate3d(0, ${vRow.start}px, 0)`,
                  willChange: 'transform',
                }}
                onClick={e => row && toggleSel(rowId, e)}
              >
                {/* Main row grid */}
                <div
                  className="grid items-center cursor-pointer"
                  style={{
                    height: `${DENSITY_H[density]}px`,
                    gridTemplateColumns: gridCols,
                    width: `${totalW}px`,
                    minWidth: '100%',
                  }}
                  onMouseDown={e => {
                    if (e.shiftKey && focused) {
                      e.preventDefault(); dragging.current = true;
                      setDragSel({ r1: focused.r, c1: focused.c, r2: vRow.index, c2: 0 });
                    }
                  }}
                  onMouseEnter={() => {
                    if (dragging.current && dragSel) setDragSel(p => p ? { ...p, r2: vRow.index } : null);
                  }}
                >
                  {isLoader ? (
                    <div className="flex h-full w-full items-center justify-center gap-2 bg-secondary/30 text-xs text-muted-foreground col-span-full">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading next 50 rows...
                    </div>
                  ) : (
                    <>
                      {/* Row # */}
                      <div className={`flex h-full w-10 shrink-0 items-center justify-center border-r border-border/30 bg-secondary/30 font-mono ${density === 'compact' ? 'text-[10px]' : 'text-xs'} text-muted-foreground/60`}>
                        {vRow.index + 1}
                      </div>
                      {/* Checkbox */}
                      <div className="flex h-full w-10 shrink-0 items-center justify-center border-r border-border/30">
                        <Checkbox checked={isSel} onClick={e => toggleSel(rowId, e)} />
                      </div>
                      {/* Expand */}
                      <div className={`flex h-full w-7 min-w-0 items-center justify-center border-r border-border/30 cursor-pointer hover:bg-muted/40 transition-colors`}
                        onClick={e => { e.stopPropagation(); setExpandedRow(isExp ? null : rowId); }}>
                        {isExp ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                      </div>

                      {/* Data cells */}
                      {visibleColumns.map((col, ci) => {
                        const cellVal = row[col.field];
                        const dispVal = fmt(cellVal, col.field, col.dataType);
                        const isFocused = focused?.r === vRow.index && focused?.c === ci;
                        const isDrag = inDrag(vRow.index, ci);
                        const isJsonCell = typeof cellVal === 'string' && (cellVal.startsWith('{') || cellVal.startsWith('[')) && isJson(cellVal);
                        return (
                          <React.Fragment key={col.field}>
                            <div className={`relative flex h-full min-w-0 items-center overflow-hidden
                              ${ci < visibleColumns.length - 1 ? 'border-r border-border/30' : ''}
                              ${isSel ? 'font-medium text-foreground' : 'text-foreground/85'}
                              ${savingCell === rowId + ':' + col.field ? 'border-l-2 border-l-amber-500/70' : ''}
                              ${savedCell === rowId + ':' + col.field ? 'border-l-2 border-l-green-500 bg-green-500/5' : ''}
                              ${isFocused ? 'outline outline-1 outline-primary/50 outline-offset-[-1px] z-10' : ''}
                              ${isDrag ? 'bg-primary/8' : ''}
                              ${onCellSave ? 'cursor-text' : ''}`}
                              
                              onClick={e => {
                                e.stopPropagation();
                                setFocused(prev => (prev?.r === vRow.index && prev?.c === ci ? null : { r: vRow.index, c: ci }));
                              }}
                              onDoubleClick={e => {
                                e.stopPropagation();
                                if (!onCellSave) return;
                                const old = row[col.field];
                                setEditingCell({ rowId, field: col.field });
                              }}
                              tabIndex={0}>
                              {editingCell?.rowId === rowId && editingCell?.field === col.field ? (
                                <CellEditor
                                  value={cellVal}
                                  density={density}
                                  onSave={async (val) => {
                                    if (!onCellSave) return;
                                    const old = row[col.field];
                                    setEditingCell(null);
                                    setSavingCell(rowId + ':' + col.field);
                                    try {
                                      await onCellSave(rowId, col.field, val);
                                      undoRef.current.push({ rowId, field: col.field, old: String(old ?? ''), val });
                                      setSavedCell(rowId + ':' + col.field);
                                      setTimeout(() => setSavedCell(null), 1200);
                                    } finally { setSavingCell(null); }
                                  }}
                                  onCancel={() => setEditingCell(null)}
                                />
                              ) : savingCell === rowId + ':' + col.field ? (
                                <span className={`flex items-center gap-1.5 w-full ${DENSITY_CELL[density]}`}>
                                  <Loader2 className="h-3 w-3 animate-spin shrink-0 text-amber-400" />
                                  <span className="truncate text-foreground/90 font-medium">{dispVal}</span>
                                </span>
                              ) : isJsonCell ? (
                                <span className={`${DENSITY_CELL[density]} w-full flex items-center gap-1`}>
                                  <span className="truncate flex-1 min-w-0 font-mono">{dispVal.slice(0, 60)}{dispVal.length > 60 ? '...' : ''}</span>
                                  <button className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground/50 hover:text-foreground shrink-0"
                                    onClick={e => { e.stopPropagation(); toggleJson(rowId + ':' + col.field); }}>
                                    <Braces className="h-3 w-3" />
                                  </button>
                                  {jsonOpen.has(rowId + ':' + col.field) && (
                                    <div className="absolute left-0 top-full mt-1 z-50 w-96 max-h-72 overflow-auto rounded-md border bg-card/95 backdrop-blur-xl shadow-xl p-3"
                                      onClick={e => e.stopPropagation()}>
                                      <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">JSON Viewer</div>
                                      <JsonTree data={JSON.parse(String(cellVal))} />
                                    </div>
                                  )}
                                </span>
                              ) : (
                                <span className={`${DENSITY_CELL[density]} w-full truncate font-mono`}>{dispVal || <span className="text-muted-foreground/30 italic">null</span>}</span>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Expanded row detail (Interactive Record Block Editor) */}
                {isExp && row && !isLoader && (
                  <div
                    style={{ height: `${EXPAND_HEIGHT}px` }}
                    className="w-full shrink-0 border-t border-border/60 bg-card/90"
                    onClick={e => e.stopPropagation()}
                  >
                    <RowBlockEditor
                      row={row}
                      rowIndex={vRow.index}
                      columns={visibleColumns}
                      onClose={() => setExpandedRow(null)}
                      onCellSave={onCellSave}
                      onCopyJson={() => {
                        navigator.clipboard.writeText(JSON.stringify(row, null, 2));
                        flash('Copied row JSON');
                      }}
                      flash={flash}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {!loading && rows.length === 0 && (
          <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center text-muted-foreground absolute inset-0 opacity-80 pointer-events-none mt-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary"><Database className="h-8 w-8 text-muted-foreground/40" /></div>
            <h3 className="text-lg font-semibold text-muted-foreground">No rows found</h3>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground/70">This table is empty. Insert a row or clear filters.</p>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/40 bg-white/[0.02] backdrop-blur-md text-[11px] text-muted-foreground shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span>{totalRowCount != null
            ? <>{rows.length.toLocaleString()} of <strong className="text-foreground/80">{totalRowCount.toLocaleString()}</strong> rows</>
            : <><strong className="text-foreground/80">{rows.length.toLocaleString()}</strong> rows</>
          }</span>
          {selectionModel.length > 0 && <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">{selectionModel.length} selected</span>}
          {rows.length > 0 && vItems.length > 0 && (
            <span className="text-muted-foreground/50">
              Row {(vItems[0]?.index + 1).toLocaleString()}–{(vItems[vItems.length - 1]?.index + 1).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button className={`p-1 rounded transition-colors ${undoRef.current.canUndo() ? 'text-foreground/70 hover:bg-muted' : 'text-muted-foreground/20 pointer-events-none'}`} onClick={handleUndo} title="Undo (Ctrl+Z)"><Undo2 className="h-3.5 w-3.5" /></button>
          <button className={`p-1 rounded transition-colors ${undoRef.current.canRedo() ? 'text-foreground/70 hover:bg-muted' : 'text-muted-foreground/20 pointer-events-none'}`} onClick={handleRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 className="h-3.5 w-3.5" /></button>
          <div className="w-px h-3.5 bg-border/50 mx-0.5" />
          <div className="flex items-center gap-0.5 rounded border border-border/50 overflow-hidden">
            {([['compact', Rows3], ['default', Table2], ['comfortable', Rows4]] as const).map(([d, Icon]) => (
              <button key={d} className={`p-1 transition-colors ${density === d ? 'bg-primary/15 text-primary' : 'text-muted-foreground/40 hover:text-foreground/60 hover:bg-muted/50'}`}
                onClick={() => setDensity(d)}><Icon className="h-3.5 w-3.5" /></button>
            ))}
          </div>
          <div className="w-px h-3.5 bg-border/50 mx-0.5" />
          <div className="relative">
            <button className={`p-1 rounded-md transition-colors ${views.length ? 'text-foreground/70 hover:bg-muted' : 'text-muted-foreground/40 hover:text-foreground/60'}`}
              onClick={() => setShowViews(!showViews)} title="Saved views"><Bookmark className="h-3.5 w-3.5" /></button>
            {showViews && (
              <div className="absolute right-0 bottom-full mb-1.5 z-50 w-64 rounded-xl border bg-card/95 backdrop-blur-xl shadow-xl p-3" onClick={e => e.stopPropagation()}>
                <div className="text-xs font-semibold mb-2">Saved Views</div>
                {views.length === 0 && <div className="text-xs text-muted-foreground py-2">No saved views yet.</div>}
                {views.map(v => (
                  <div key={v.id} className="flex items-center justify-between py-1.5 group">
                    <button className="text-xs text-left hover:text-primary flex-1 truncate" onClick={() => applyView(v)}>{v.name}</button>
                    <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5" onClick={() => deleteView(v.id)}><X className="h-3 w-3" /></button>
                  </div>
                ))}
                <div className="flex gap-1.5 mt-2 pt-2 border-t border-border/50">
                  <Input className="h-7 text-xs flex-1 rounded-lg" placeholder="View name..." value={viewName} onChange={e => setViewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveView(); }} />
                  <Button size="sm" variant="outline" className="h-7 text-[10px] rounded-xl" onClick={saveView}>Save</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full bg-foreground text-background text-xs font-medium shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CellEditor  (separate component — own hooks for edit state)        */
/* ------------------------------------------------------------------ */

function CellEditor({ value, density, onSave, onCancel }: {
  value: any; density: RowDensity; onSave: (v: string) => Promise<void>; onCancel: () => void;
}) {
  const [v, setV] = React.useState(value != null ? String(value) : '');
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { setTimeout(() => ref.current?.focus(), 30); }, []);
  return (
    <input ref={ref} value={v} onChange={e => setV(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSave(v); } if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
      onBlur={() => onSave(v)} onClick={e => e.stopPropagation()}
      className="absolute inset-0 w-full h-full px-3 bg-background text-foreground font-mono border-2 border-primary focus:outline-none rounded-none z-30"
      style={{ fontSize: density === 'compact' ? '11px' : '14px' }} autoFocus />
  );
}

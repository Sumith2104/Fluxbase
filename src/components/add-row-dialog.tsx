
'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Plus } from 'lucide-react';
import { addRowAction } from '@/app/(app)/editor/actions';
import { useToast } from '@/hooks/use-toast';
import { type Column, type Constraint, type Table as DbTable } from '@/lib/data';
import { SubmitButton } from './submit-button';
import { useState } from 'react';
import { ForeignKeySelect } from './foreign-key-select';

type AddRowDialogProps = {
  projectId: string;
  tableId: string;
  tableName: string;
  columns: Column[];
  onRowAdded: () => void;
  foreignKeyData: Record<string, any[]>;
  allTables: DbTable[];
  constraints: Constraint[];
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function AddRowDialog({
  projectId,
  tableId,
  tableName,
  columns,
  onRowAdded,
  foreignKeyData,
  allTables,
  constraints,
  isOpen: propIsOpen,
  onOpenChange
}: AddRowDialogProps) {
  const { toast } = useToast();
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isOpen = propIsOpen !== undefined ? propIsOpen : internalIsOpen;
  const setIsOpen = onOpenChange || setInternalIsOpen;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const result = await addRowAction(formData);
      if (result.success) {
        toast({
          title: 'Success',
          description: 'Row added successfully.',
        });
        setIsOpen(false);
        onRowAdded();
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.error || 'Failed to add row.',
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Failed to add row.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const fkConstraints = constraints.filter(c => c.type === 'FOREIGN KEY');

  const renderInput = (col: Column) => {
    const fkConstraint = fkConstraints.find(c => c.column_names === col.column_name);
    if (fkConstraint && foreignKeyData[col.column_name]) {
      const refTable = allTables.find(t => t.table_id === fkConstraint.referenced_table_id);
      const refColumn = fkConstraint.referenced_column_names || 'id';

      let displayColumn = 'name'; // default
      // A simple heuristic to find a good display column
      const firstRow = foreignKeyData[col.column_name][0];
      if (firstRow) {
        if ('name' in firstRow) displayColumn = 'name';
        else if ('title' in firstRow) displayColumn = 'title';
        else if ('label' in firstRow) displayColumn = 'label';
        else if ('email' in firstRow) displayColumn = 'email';
      }

      return (
        <ForeignKeySelect
          name={col.column_name}
          data={foreignKeyData[col.column_name]}
          refTable={refTable}
          valueColumn={refColumn}
          displayColumn={displayColumn}
        />
      )
    }
    const dt = (col.data_type || '').toLowerCase();
    const colName = col.column_name.toLowerCase();
    const isNum = ['int', 'integer', 'number', 'double', 'float', 'real', 'numeric', 'bigint', 'smallint'].some(t => dt.includes(t));
    const isDate = dt === 'date';
    const isDateTime = ['timestamp', 'timestamptz', 'datetime'].some(t => dt.includes(t));
    const isTimestampCol = ['timestamp', 'created_at', 'updated_at', 'logged_at', 'tap_at_time'].includes(colName);
    const inputType = isNum ? 'number' : isDate ? 'date' : (isDateTime ? 'datetime-local' : 'text');
    const isRequired = !col.is_nullable && !col.default_value && !isTimestampCol;

    let defaultVal: string | undefined = undefined;
    if (isTimestampCol || isDateTime) {
      const d = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      if (inputType === 'datetime-local') {
        defaultVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else {
        defaultVal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
    }

    return (
      <Input
        id={col.column_name}
        name={col.column_name}
        className="col-span-3"
        type={inputType}
        step={isNum ? 'any' : undefined}
        required={isRequired}
        placeholder={isRequired ? 'Required' : 'Optional'}
        defaultValue={defaultVal}
      />
    );
  };

  const isAutoIncrement = (col: Column) => Boolean(
    (col.default_value && (
      col.default_value.toLowerCase().includes('nextval') ||
      col.default_value.toLowerCase().includes('auto_increment') ||
      col.default_value.toLowerCase().includes('gen_random_uuid') ||
      col.default_value.toLowerCase().includes('current_timestamp')
    )) ||
    (col.column_name === 'id' && (Boolean(col.default_value) || col.is_primary_key))
  );

  const visibleColumns = columns.filter(col =>
    !isAutoIncrement(col) &&
    col.data_type !== 'gen_random_uuid()' &&
    col.default_value !== 'now()' &&
    col.data_type !== 'now_date()' &&
    col.data_type !== 'now_time()'
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 text-xs font-medium">
          <Plus className="mr-1 h-3 w-3" />
          Insert Row
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Row</DialogTitle>
          <DialogDescription>
            Fill in the details for the new row. Fields marked with * are required.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="tableId" value={tableId} />
          <input type="hidden" name="tableName" value={tableName} />

          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-1">
            {visibleColumns.map((col) => (
              <div key={col.column_id} className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor={col.column_name} className="text-right flex items-center justify-end gap-1">
                  <span>{col.column_name}</span>
                  {!col.is_nullable && !col.default_value && (
                    <span className="text-destructive font-bold">*</span>
                  )}
                </Label>
                {renderInput(col)}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add Row'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

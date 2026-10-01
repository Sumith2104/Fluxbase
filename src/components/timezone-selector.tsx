'use client';

import * as React from 'react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Globe } from 'lucide-react';
import { ProjectContext } from '@/contexts/project-context';
import { updateProjectTimezone } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';

export function TimezoneSelector() {
    const { project, setProject } = React.useContext(ProjectContext);
    const { toast } = useToast();

    // Use Intl API to get a list of supported timezones
    const timezones = React.useMemo(() => {
        try {
            return Intl.supportedValuesOf('timeZone');
        } catch {
            // Fallback list if Intl.supportedValuesOf is not supported
            return ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
        }
    }, []);

    if (!project) return null;

    const handleTimezoneChange = async (newTimezone: string) => {
        const oldTimezone = project.timezone;

        // Optimistic UI update
        setProject({ ...project, timezone: newTimezone });

        try {
            await updateProjectTimezone(project.project_id, newTimezone);
            toast({
                title: "Timezone Updated",
                description: `Project timezone set to ${newTimezone}`,
            });
        } catch (error: any) {
            // Revert on error
            setProject({ ...project, timezone: oldTimezone });
            toast({
                title: "Error",
                description: error.message || "Failed to update timezone",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="hidden sm:flex items-center shrink-0">
            <Select value={project.timezone || ''} onValueChange={handleTimezoneChange}>
                <SelectTrigger className="h-6 gap-1 px-2 py-0 text-xs border bg-secondary/30 hover:bg-secondary/50 w-auto font-normal opacity-80 focus:ring-0 rounded-full !outline-none shrink-0 whitespace-nowrap">
                    <Globe className="h-3 w-3 shrink-0" />
                    <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent align="end" className="max-h-[300px]">
                    {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz} className="text-xs">
                            {tz}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

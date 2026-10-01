
'use client';

import * as React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown, Plus, Settings } from 'lucide-react';
import type { Project } from '@/lib/data';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useContext } from 'react';
import { ProjectContext } from '@/contexts/project-context';
import { cn } from '@/lib/utils';
import Image from 'next/image';

type ProjectSwitcherProps = {
  headerTitle: string;
  orgName: string;
  projects: Project[];
  selectedProject: Project | null;
};

export function ProjectSwitcher({
  headerTitle,
  orgName,
  projects,
  selectedProject,
}: ProjectSwitcherProps) {
  const router = useRouter();
  const { setProject } = useContext(ProjectContext);

  const handleSelect = (project: Project | null) => {
    setProject(project);

    // Explicitly navigate so Server Components see the new ?projectId
    if (project) {
      // If we want to stay on the same page but swap projects:
      const currentPath = window.location.pathname;
      if (currentPath.startsWith('/editor') || currentPath.startsWith('/database') || currentPath.startsWith('/api') || currentPath.startsWith('/query')) {
        router.push(`${currentPath}?projectId=${project.project_id}`);
      } else {
        // Fallback to routing to their dashboard overview
        router.push('/dashboard');
      }
    } else {
      router.push('/dashboard/projects');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="min-w-0 px-1.5 text-sm font-semibold sm:px-2 sm:text-lg">
          <span className="max-w-[130px] sm:max-w-[180px] md:max-w-[220px] lg:max-w-[280px] truncate">
            {headerTitle}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 text-muted-foreground flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{orgName}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => handleSelect(null)}>
            <div className="flex items-center w-full">
              <span className="flex-1">Switch Project</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.project_id}
              onSelect={() => handleSelect(project)}
            >
              <div className="flex items-center w-full min-w-0 gap-3 py-0.5">
                {/* Project Name (Truncated) */}
                <span className="flex-1 truncate font-medium text-sm text-foreground/90 group-hover:text-foreground transition-colors pr-1">
                    {project.display_name}
                </span>

                {/* Metadata Badges Container (Fixed Width/Alignment) */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border shrink-0 whitespace-nowrap",
                        project.dialect?.toLowerCase() === 'mysql' 
                          ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' 
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                    )}>
                      {project.dialect?.toLowerCase() === 'mysql' ? 'MySQL' : 'PG'}
                    </span>
                    
                    {project.role && (
                        <span className={cn(
                            "text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border shadow-sm transition-colors shrink-0 whitespace-nowrap",
                            project.role === 'admin' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 group-hover:bg-amber-500/20' : 
                            project.role === 'developer' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 group-hover:bg-blue-500/20' : 
                            'bg-secondary text-muted-foreground border-border group-hover:bg-muted'
                        )}>
                            {project.role}
                        </span>
                    )}
                </div>

                {/* Selected Checkmark */}
                <div className="w-4 flex-shrink-0 flex justify-end">
                    {selectedProject?.project_id === project.project_id && (
                        <Check className="h-4 w-4 text-primary animate-in zoom-in-50 duration-200" />
                    )}
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/projects">
            <Plus className="mr-2 h-4 w-4" />
            Create Project
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={selectedProject?.project_id ? `/settings?projectId=${selectedProject.project_id}` : '/settings'}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@heroui/react";
import { 
  DatabaseIcon, 
  SettingsIcon, 
  WorkflowIcon, 
  PlayIcon,
  FolderOpenIcon
} from "lucide-react";
import { getProjectConfig } from "@/app/actions/project_actions";

interface SidebarProps {
  projectId: string;
  useRag: boolean;
}

export default function Sidebar({ projectId, useRag }: SidebarProps) {
  const pathname = usePathname();
  const [projectName, setProjectName] = useState<string>("Select Project");
  const isProjectsRoute = pathname === '/projects' || pathname === '/projects/select';

  useEffect(() => {
    async function fetchProjectName() {
      if (!isProjectsRoute && projectId) {
        try {
          const project = await getProjectConfig(projectId);
          setProjectName(project.name);
        } catch (error) {
          console.error('Failed to fetch project name:', error);
          setProjectName("Select Project");
        }
      }
    }
    fetchProjectName();
  }, [projectId, isProjectsRoute]);

  const navItems = [
    {
      href: 'workflow',
      label: 'Build',
      icon: WorkflowIcon,
      requiresProject: true
    },
    {
      href: 'test',
      label: 'Test',
      icon: PlayIcon,
      requiresProject: true
    },
    ...(useRag ? [{
      href: 'sources',
      label: 'Connect',
      icon: DatabaseIcon,
      requiresProject: true
    }] : []),
    {
      href: 'config',
      label: 'Integrate',
      icon: SettingsIcon,
      requiresProject: true
    }
  ];

  return (
    <aside className="w-60 bg-transparent flex flex-col">
      {/* Project Selector - keeping original position */}
      <div className="p-3">
        <Tooltip content="Change project" showArrow placement="right">
          <Link 
            href="/projects"
            className="flex items-center gap-3 px-4 py-2.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all"
          >
            <FolderOpenIcon size={18} className="text-zinc-500 dark:text-zinc-400" />
            <span className="text-sm font-medium truncate">
              {projectName}
            </span>
          </Link>
        </Tooltip>
      </div>

      {/* Navigation Items with increased size and spacing */}
      <nav className="flex-1 p-3 space-y-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const fullPath = `/projects/${projectId}/${item.href}`;
          const isActive = pathname.startsWith(fullPath);
          const isDisabled = isProjectsRoute && item.requiresProject;
          
          return (
            <Link 
              key={item.href} 
              href={isDisabled ? '#' : fullPath}
              className={isDisabled ? 'pointer-events-none' : ''}
            >
              <button 
                className={`
                  relative w-full px-4 py-4 rounded-md flex items-center gap-3
                  text-[15px] font-medium transition-all duration-200
                  ${isActive 
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-l-2 border-indigo-600 dark:border-indigo-400' 
                    : isDisabled
                      ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-300'
                  }
                `}
                disabled={isDisabled}
              >
                <Icon 
                  size={20} 
                  className={`
                    transition-colors duration-200
                    ${isDisabled 
                      ? 'text-zinc-300 dark:text-zinc-600' 
                      : isActive
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }
                  `}
                />
                <span>{item.label}</span>
              </button>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
} 
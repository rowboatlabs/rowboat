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
  const [projectName, setProjectName] = useState<string>(projectId);

  useEffect(() => {
    async function fetchProjectName() {
      const project = await getProjectConfig(projectId);
      setProjectName(project.name);
    }
    fetchProjectName();
  }, [projectId]);

  const navItems = [
    {
      href: 'workflow',
      label: 'Build',
      icon: WorkflowIcon
    },
    {
      href: 'test',
      label: 'Test',
      icon: PlayIcon
    },
    ...(useRag ? [{
      href: 'sources',
      label: 'Connect',
      icon: DatabaseIcon
    }] : []),
    {
      href: 'config',
      label: 'Integrate',
      icon: SettingsIcon
    }
  ];

  return (
    <aside className="w-60 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
      {/* Project Selector */}
      <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
        <Tooltip content="Change project" showArrow placement="right">
          <Link 
            href="/projects"
            className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <FolderOpenIcon size={16} />
            <span className="text-sm font-medium truncate">
              {projectName}
            </span>
          </Link>
        </Tooltip>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(`/projects/${projectId}/${item.href}`);
          
          return (
            <Link key={item.href} href={`/projects/${projectId}/${item.href}`}>
              <button className={`
                w-full px-3 py-2 rounded-md flex items-center gap-3
                text-sm font-medium
                ${isActive 
                  ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' 
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }
              `}>
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
} 
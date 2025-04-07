'use client';
import { useEffect, useState } from 'react';
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@heroui/react";
import { UserButton } from "@/app/lib/components/user_button";
import { 
  DatabaseIcon, 
  SettingsIcon, 
  WorkflowIcon, 
  PlayIcon,
  FolderOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Moon
} from "lucide-react";
import { getProjectConfig } from "@/app/actions/project_actions";
import { useTheme } from "@/app/providers/theme-provider";
import { USE_TESTING_FEATURE } from '@/app/lib/feature_flags';

interface SidebarProps {
  projectId: string;
  useRag: boolean;
  useAuth: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const EXPANDED_ICON_SIZE = 20;
const COLLAPSED_ICON_SIZE = 20; // DO NOT CHANGE THIS

export default function Sidebar({ projectId, useRag, useAuth, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const [projectName, setProjectName] = useState<string>("Select Project");
  const isProjectsRoute = pathname === '/projects' || pathname === '/projects/select';
  const { theme, toggleTheme } = useTheme();

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
    ...(USE_TESTING_FEATURE ? [{
      href: 'test',
      label: 'Test',
      icon: PlayIcon,
      requiresProject: true
    }] : []),
    ...(useRag ? [{
      href: 'sources',
      label: 'RAG',
      icon: DatabaseIcon,
      requiresProject: true
    }] : []),
    {
      href: 'config',
      label: 'Settings',
      icon: SettingsIcon,
      requiresProject: true
    }
  ];

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-transparent flex flex-col h-full transition-all duration-300`}>
      <div className="flex flex-col flex-grow">
        {!isProjectsRoute && (
          <>
            {/* Project Selector */}
            <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
              <Tooltip content={collapsed ? projectName : "Change project"} showArrow placement="right">
                <Link 
                  href="/projects"
                  className={`
                    flex items-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all
                    ${collapsed ? 'justify-center py-4' : 'gap-3 px-4 py-2.5'}
                  `}
                >
                  <FolderOpenIcon 
                    size={collapsed ? COLLAPSED_ICON_SIZE : EXPANDED_ICON_SIZE} 
                    className="text-zinc-500 dark:text-zinc-400 transition-all duration-200" 
                  />
                  {!collapsed && (
                    <span className="text-sm font-medium truncate">
                      {projectName}
                    </span>
                  )}
                </Link>
              </Tooltip>
            </div>

            {/* Navigation Items */}
            <nav className="p-3 space-y-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const fullPath = `/projects/${projectId}/${item.href}`;
                const isActive = pathname.startsWith(fullPath);
                const isDisabled = isProjectsRoute && item.requiresProject;
                
                return (
                  <Tooltip 
                    key={item.href}
                    content={collapsed ? item.label : ""}
                    showArrow 
                    placement="right"
                  >
                    <Link 
                      href={isDisabled ? '#' : fullPath}
                      className={isDisabled ? 'pointer-events-none' : ''}
                    >
                      <button 
                        className={`
                          relative w-full rounded-md flex items-center
                          text-[15px] font-medium transition-all duration-200
                          ${collapsed ? 'justify-center py-4' : 'px-4 py-4 gap-3'}
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
                          size={collapsed ? COLLAPSED_ICON_SIZE : EXPANDED_ICON_SIZE} 
                          className={`
                            transition-all duration-200
                            ${isDisabled 
                              ? 'text-zinc-300 dark:text-zinc-600' 
                              : isActive
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-zinc-500 dark:text-zinc-400'
                            }
                          `}
                        />
                        {!collapsed && <span>{item.label}</span>}
                      </button>
                    </Link>
                  </Tooltip>
                );
              })}
            </nav>
          </>
        )}
      </div>

      {/* Bottom section */}
      <div className="mt-auto">
        {/* Collapse Toggle Button */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all"
          >
            {collapsed ? (
              <ChevronRightIcon size={20} className="text-zinc-500 dark:text-zinc-400" />
            ) : (
              <ChevronLeftIcon size={20} className="text-zinc-500 dark:text-zinc-400" />
            )}
          </button>
        </div>

        {/* Theme and Auth Controls */}
        <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
          <Tooltip content={collapsed ? "Appearance" : ""} showArrow placement="right">
            <button 
              onClick={toggleTheme}
              className={`
                w-full rounded-md flex items-center
                text-[15px] font-medium transition-all duration-200
                ${collapsed ? 'justify-center py-4' : 'px-4 py-4 gap-3'}
                hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                text-zinc-600 dark:text-zinc-400
              `}
            >
              <Moon size={COLLAPSED_ICON_SIZE} />
              {!collapsed && <span>Appearance</span>}
            </button>
          </Tooltip>

          {useAuth && (
            <Tooltip content={collapsed ? "Account" : ""} showArrow placement="right">
              <div 
                className={`
                  w-full rounded-md flex items-center
                  text-[15px] font-medium transition-all duration-200
                  ${collapsed ? 'justify-center py-4' : 'px-4 py-4 gap-3'}
                  hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                `}
              >
                <UserButton />
                {!collapsed && <span>Account</span>}
              </div>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
} 
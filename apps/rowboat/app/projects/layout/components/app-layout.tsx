'use client';
import { ReactNode } from 'react';
import { Sidebar, TopBar } from './index';
import { usePathname } from 'next/navigation';

interface AppLayoutProps {
  children: ReactNode;
  useRag?: boolean;
}

export default function AppLayout({ children, useRag = false }: AppLayoutProps) {
  const pathname = usePathname();
  const projectId = pathname.split('/')[2];
  const isProjectsRoute = pathname === '/projects' || pathname === '/projects/select';

  // For projects route, show only topbar and content
  if (isProjectsRoute) {
    return (
      <div className="h-screen flex flex-col gap-5 p-5 bg-zinc-50 dark:bg-zinc-900">
        <div className="overflow-hidden rounded-xl bg-white/70 dark:bg-zinc-800/70 shadow-sm backdrop-blur-sm">
          <header className="sticky top-0 z-50">
            <TopBar />
          </header>
        </div>
        <main className="flex-1 overflow-auto rounded-xl bg-white dark:bg-zinc-800 shadow-sm p-4">
          {children}
        </main>
      </div>
    );
  }

  // For invalid projectId, return just the children
  if (!projectId) {
    return children;
  }

  // Normal layout with sidebar for project pages
  return (
    <div className="h-screen flex gap-5 p-5 bg-zinc-50 dark:bg-zinc-900">
      {/* Sidebar with improved shadow and blur */}
      <div className="overflow-hidden rounded-xl bg-white/70 dark:bg-zinc-800/70 shadow-sm backdrop-blur-sm">
        <Sidebar projectId={projectId} useRag={useRag} />
      </div>
      
      {/* Main content area with improved styling */}
      <div className="flex-1 flex flex-col">
        <div className="overflow-hidden rounded-xl bg-white/70 dark:bg-zinc-800/70 shadow-sm backdrop-blur-sm mb-5">
          <header className="sticky top-0 z-50">
            <TopBar />
          </header>
        </div>
        <main className="flex-1 overflow-auto rounded-xl bg-white dark:bg-zinc-800 shadow-sm p-4">
          {children}
        </main>
      </div>
    </div>
  );
} 
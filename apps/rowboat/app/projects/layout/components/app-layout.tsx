'use client';
import { ReactNode } from 'react';
import HorizontalMenu from './horizontal-menu';

interface AppLayoutProps {
  children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 backdrop-blur-sm supports-[backdrop-filter]:bg-white/70">
        <HorizontalMenu />
      </header>
      <main className="flex-1 overflow-auto bg-background dark:bg-background p-4">
        {children}
      </main>
    </div>
  );
} 
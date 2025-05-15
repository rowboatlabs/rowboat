'use client';

import * as React from "react";
import { XIcon } from 'lucide-react';
import { Button } from './button';
import { clsx } from 'clsx';

interface SlidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}

export function SlidePanel({
  isOpen,
  onClose,
  title,
  children,
  width = '500px'
}: SlidePanelProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setMounted(true);
    } else {
      const timer = setTimeout(() => setMounted(false), 300); // Match transition duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div 
        className={clsx(
          "fixed inset-0 bg-black/50 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div 
        className={clsx(
          "fixed right-0 top-0 h-full bg-white dark:bg-zinc-900 shadow-xl transition-transform duration-300 transform",
          "border-l border-zinc-200 dark:border-zinc-800",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{ width }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 p-2"
          >
            <XIcon className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 h-[calc(100vh-73px)] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
} 
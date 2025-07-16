'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Composio } from '../../tools/components/Composio';
import { ComposioWithCallback } from './ComposioWithCallback';

interface ComposioToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onToolsUpdated?: () => void;
}

export function ComposioToolsModal({ isOpen, onClose, projectId, onToolsUpdated }: ComposioToolsModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // Prevent scrolling when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl 
        w-full max-w-6xl mx-4 animate-in fade-in zoom-in duration-200 
        max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Composio Tools
          </h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            className="p-1.5"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <ComposioWithCallback onToolsUpdated={onToolsUpdated} />
        </div>
      </div>
    </div>
  );
}
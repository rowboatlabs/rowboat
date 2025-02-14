'use client';

import { useState, useEffect, useCallback } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { WithStringId } from '../../../../lib/types/types';
import { Scenario } from "../../../../lib/types/testing_types";
import { z } from 'zod';

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;

interface ScenarioViewerProps {
  scenario: ScenarioType;
  onSave: (scenario: ScenarioType) => void;
  onClose: () => void;
}

export function ScenarioViewer({ scenario, onSave, onClose }: ScenarioViewerProps) {
  const [editedScenario, setEditedScenario] = useState<ScenarioType>(scenario);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  // Reset state when scenario changes
  useEffect(() => {
    setEditedScenario(scenario);
  }, [scenario]);

  const handleChange = useCallback((field: keyof ScenarioType, value: string) => {
    setEditedScenario(prev => ({
      ...prev,
      [field]: value,
    }));

    // Clear existing timeout
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Set new timeout
    const timeoutId = setTimeout(() => {
      onSave({
        ...editedScenario,
        [field]: value,
      });
    }, 500);

    setSaveTimeout(timeoutId);
  }, [editedScenario, onSave, saveTimeout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  }, [saveTimeout]);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Scenario Details</h1>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-gray-100"
          title="Close"
        >
          <XMarkIcon className="h-5 w-5 text-gray-600" />
        </button>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">NAME</div>
          <input
            type="text"
            value={editedScenario.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="text-base border border-gray-200 rounded px-2 py-1 hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">DESCRIPTION</div>
          <textarea
            value={editedScenario.description}
            onChange={(e) => handleChange('description', e.target.value)}
            className="text-base border border-gray-200 rounded px-2 py-1 hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 min-h-[24px] resize-none"
            style={{ height: 'auto', minHeight: '24px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
          />
        </div>
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CRITERIA</div>
          <textarea
            value={editedScenario.criteria}
            onChange={(e) => handleChange('criteria', e.target.value)}
            className="text-base border border-gray-200 rounded px-2 py-1 hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 min-h-[24px] resize-none"
            style={{ height: 'auto', minHeight: '24px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
          />
        </div>

        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CONTEXT</div>
          <textarea
            value={editedScenario.context}
            onChange={(e) => handleChange('context', e.target.value)}
            className="text-base border border-gray-200 rounded px-2 py-1 hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 min-h-[24px] resize-none"
            style={{ height: 'auto', minHeight: '24px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
          />
        </div>
      </div>
    </div>
  );
} 
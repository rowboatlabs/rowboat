'use client';

import { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { WithStringId } from '../../../../lib/types/types';
import { Scenario } from "../../../../lib/types/testing_types";
import { z } from 'zod';
import { EditableField } from '../../../../lib/components/editable-field';

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;

interface ScenarioViewerProps {
  scenario: ScenarioType;
  onSave: (scenario: ScenarioType) => void;
  onClose: () => void;
}

export function ScenarioViewer({ scenario, onSave, onClose }: ScenarioViewerProps) {
  const [editedScenario, setEditedScenario] = useState<ScenarioType>(scenario);

  // Reset state when scenario changes
  useEffect(() => {
    setEditedScenario(scenario);
  }, [scenario]);

  const handleFieldChange = (field: keyof ScenarioType) => (value: string) => {
    const updatedScenario = {
      ...editedScenario,
      [field]: value,
    };
    setEditedScenario(updatedScenario);
    onSave(updatedScenario);
  };

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
        <EditableField
          label="NAME"
          value={editedScenario.name}
          onChange={handleFieldChange('name')}
          placeholder="Enter scenario name..."
        />
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <EditableField
          label="DESCRIPTION"
          value={editedScenario.description}
          onChange={handleFieldChange('description')}
          placeholder="Enter scenario description..."
          multiline
          markdown
        />
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <EditableField
          label="CRITERIA"
          value={editedScenario.criteria}
          onChange={handleFieldChange('criteria')}
          placeholder="Enter success criteria..."
          multiline
          markdown
        />

        <div className="border-t border-gray-200 my-4"></div>
        
        <EditableField
          label="CONTEXT"
          value={editedScenario.context}
          onChange={handleFieldChange('context')}
          placeholder="Enter scenario context..."
          multiline
          markdown
        />
      </div>
    </div>
  );
} 
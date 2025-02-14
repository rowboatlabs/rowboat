'use client';

import { useState } from 'react';
import { PencilIcon, XMarkIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { WithStringId } from '../../../../lib/types/types';
import { Scenario } from "../../../../lib/types/testing_types";
import { z } from 'zod';

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;

interface ScenarioViewerProps {
  scenario: ScenarioType;
  onEdit: () => void;
  onClose: () => void;
}

export function ScenarioViewer({ scenario, onEdit, onClose }: ScenarioViewerProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{scenario.name}</h1>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Edit"
          >
            <PencilIcon className="h-5 w-5 text-gray-600" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Close"
          >
            <XMarkIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">NAME</div>
          <div className="text-base">{scenario.name}</div>
        </div>
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">DESCRIPTION</div>
          <div className="text-base whitespace-pre-wrap">{scenario.description}</div>
        </div>
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CRITERIA</div>
          <div className="text-base whitespace-pre-wrap">{scenario.criteria}</div>
        </div>

        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CONTEXT</div>
          <div className="text-base whitespace-pre-wrap">{scenario.context}</div>
        </div>
      </div>
    </div>
  );
}

interface ScenarioEditorProps {
  scenario: ScenarioType;
  onSave: (scenario: ScenarioType) => void;
  onCancel: () => void;
}

export function ScenarioEditor({ scenario, onSave, onCancel }: ScenarioEditorProps) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description);
  const [criteria, setCriteria] = useState(scenario.criteria || '');
  const [context, setContext] = useState(scenario.context || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...scenario,
      name,
      description,
      criteria,
      context,
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Edit Scenario</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Save"
          >
            <DocumentDuplicateIcon className="h-5 w-5 text-gray-600" />
          </button>
          <button
            onClick={onCancel}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Close"
          >
            <XMarkIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">NAME</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
            placeholder="An identifiable scenario name"
          />
        </div>

        <div className="border-t border-gray-200 my-4"></div>

        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">DESCRIPTION</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
            placeholder="Specify the user scenario that the simulator should simulate"
          />
        </div>

        <div className="border-t border-gray-200 my-4"></div>

        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CRITERIA</div>
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
            placeholder="Enter success criteria for this scenario"
          />
        </div>

        <div className="border-t border-gray-200 my-4"></div>

        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CONTEXT</div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
            placeholder="Provide context about the user to the assistant at the start of chat"
          />
        </div>
      </form>
    </div>
  );
} 
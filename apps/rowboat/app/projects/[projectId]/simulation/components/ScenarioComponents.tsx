'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, EllipsisVerticalIcon, PlayIcon, TrashIcon, X } from "lucide-react";
import { WithStringId } from '../../../../lib/types/types';
import { Scenario } from "../../../../lib/types/testing_types";
import { z } from 'zod';
import { EditableField } from '../../../../lib/components/editable-field';
import { FormSection } from '../../../../lib/components/form-section';
import { StructuredPanel, ActionButton } from "../../../../lib/components/structured-panel";
import clsx from "clsx";
import { Dropdown, DropdownItem, DropdownTrigger, DropdownMenu } from "@nextui-org/react";
import { SectionHeader, ListItem } from "../../../../lib/components/structured-list";

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;

interface ScenarioViewerProps {
  scenario: ScenarioType;
  onSave: (scenario: ScenarioType) => void;
  onClose: () => void;
}

export function ScenarioViewer({ scenario, onSave, onClose }: ScenarioViewerProps) {
  const [editedScenario, setEditedScenario] = useState<ScenarioType>(scenario);
  const [isDirty, setIsDirty] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setEditedScenario(scenario);
    setIsDirty(false);
  }, [scenario]);

  const handleChange = useCallback((field: keyof ScenarioType, value: string) => {
    if (field === 'name') {
      setNameError(value.trim() ? null : 'Name is required');
    }
    setEditedScenario(prev => ({
      ...prev,
      [field]: value,
    }));
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!editedScenario.name.trim()) {
      setNameError('Name is required');
      return;
    }
    onSave(editedScenario);
    onClose();
  }, [editedScenario, onSave, onClose]);

  return (
    <StructuredPanel 
      title="SCENARIO DETAILS"
      actions={[
        isDirty && (
          <ActionButton
            key="save"
            onClick={handleSave}
            icon={<Save className="w-4 h-4" />}
            primary
          >
            Save
          </ActionButton>
        ),
        <ActionButton
          key="close"
          onClick={onClose}
          icon={<X className="w-4 h-4" />}
        >
          Close
        </ActionButton>
      ].filter(Boolean)}
    >
      <div className="flex flex-col gap-4">
        <FormSection label="Name" showDivider>
          <EditableField
            value={editedScenario.name}
            onChange={(value) => handleChange('name', value)}
            multiline={false}
            className="w-full"
            showSaveButton={false}
            placeholder="Enter an identifiable scenario name"
            error={nameError}
          />
        </FormSection>
        
        <FormSection label="Description" showDivider>
          <EditableField
            value={editedScenario.description}
            onChange={(value) => handleChange('description', value)}
            multiline={true}
            className="w-full"
            showSaveButton={false}
            placeholder="Describe the user scenario to be simulated"
          />
        </FormSection>
        
        <FormSection label="Criteria" showDivider>
          <EditableField
            value={editedScenario.criteria}
            onChange={(value) => handleChange('criteria', value)}
            multiline={true}
            className="w-full"
            showSaveButton={false}
            placeholder="Enter success criteria for this scenario to pass in a simulation"
          />
        </FormSection>
        
        <FormSection label="Context">
          <EditableField
            value={editedScenario.context}
            onChange={(value) => handleChange('context', value)}
            multiline={true}
            className="w-full"
            showSaveButton={false}
            placeholder="Provide context about the user to the assistant at the start of chat"
          />
        </FormSection>
      </div>
    </StructuredPanel>
  );
}

function ScenarioDropdown({
    name,
    onRun,
    onDelete,
}: {
    name: string;
    onRun: () => void;
    onDelete: () => void;
}) {
    return (
        <Dropdown>
            <DropdownTrigger>
                <EllipsisVerticalIcon size={16} />
            </DropdownTrigger>
            <DropdownMenu
                onAction={(key) => {
                    if (key === 'run') onRun();
                    if (key === 'delete') onDelete();
                }}
            >
                <DropdownItem 
                    key="run" 
                    startContent={<PlayIcon className="w-4 h-4" />}
                >
                    Run scenario
                </DropdownItem>
                <DropdownItem 
                    key="delete" 
                    className="text-danger"
                    startContent={<TrashIcon className="w-4 h-4" />}
                >
                    Delete
                </DropdownItem>
            </DropdownMenu>
        </Dropdown>
    );
}

export function ScenarioList({ 
    scenarios, 
    selectedId, 
    onSelect, 
    onAdd,
    onRunScenario,
    onDeleteScenario,
}: {
    scenarios: ScenarioType[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onRunScenario: (id: string) => void;
    onDeleteScenario: (id: string) => void;
}) {
    return (
        <StructuredPanel 
            title="TESTS"
            tooltip="Browse and manage your test scenarios"
        >
            <div className="overflow-auto flex flex-col gap-1 justify-start">
                <SectionHeader title="Scenarios" onAdd={onAdd} />
                {scenarios.map((scenario) => (
                    <ListItem
                        key={scenario._id}
                        name={scenario.name}
                        isSelected={selectedId === scenario._id}
                        onClick={() => onSelect(scenario._id)}
                        rightElement={
                            <ScenarioDropdown 
                                name={scenario.name}
                                onRun={() => onRunScenario(scenario._id)}
                                onDelete={() => onDeleteScenario(scenario._id)}
                            />
                        }
                    />
                ))}
            </div>
        </StructuredPanel>
    );
} 
'use client';

import React from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react';
import { ToolsConfig } from '../../tools/components/ToolsConfig';
import { z } from 'zod';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';

interface ToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: Partial<z.infer<typeof WorkflowTool>>) => void;
  initialToolkitSlug?: string | null;
}

export function ToolsModal({
  isOpen,
  onClose,
  projectId,
  tools,
  onAddTool,
  initialToolkitSlug
}: ToolsModalProps) {
  function handleAddTool(tool: Partial<z.infer<typeof WorkflowTool>>) {
    onAddTool(tool);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>
          <h3 className="text-lg font-semibold">
            Add tools
          </h3>
        </ModalHeader>
        <ModalBody>
          <ToolsConfig
            useComposioTools={true}
            projectId={projectId}
            tools={tools}
            onAddTool={handleAddTool}
            initialToolkitSlug={initialToolkitSlug}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
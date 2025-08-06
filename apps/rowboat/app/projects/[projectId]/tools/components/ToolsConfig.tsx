'use client';

import { useState } from 'react';
import { Tabs, Tab } from '@/components/ui/tabs';
import { CustomMcpServers } from './CustomMcpServer';
import { SelectComposioToolkit } from './SelectComposioToolkit';
import { ComposioToolsPanel } from './ComposioToolsPanel';
import { AddWebhookTool } from './AddWebhookTool';
import type { Key } from 'react';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';
import { ZToolkit } from '@/app/lib/composio/composio';
import { z } from 'zod';

interface ToolsConfigProps {
  projectId: string;
  useComposioTools: boolean;
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: Partial<z.infer<typeof WorkflowTool>>) => void;
  initialToolkitSlug?: string | null;
}

type ToolkitType = z.infer<typeof ZToolkit>;

export function ToolsConfig({
  projectId,
  useComposioTools,
  tools,
  onAddTool,
  initialToolkitSlug
}: ToolsConfigProps) {
  let defaultActiveTab = 'mcp';
  if (useComposioTools) {
    defaultActiveTab = 'composio';
  }
  const [activeTab, setActiveTab] = useState(defaultActiveTab);
  const [selectedToolkit, setSelectedToolkit] = useState<ToolkitType | null>(null);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(false);

  const handleTabChange = (key: Key) => {
    setActiveTab(key.toString());
  };

  const handleSelectToolkit = (toolkit: ToolkitType) => {
    setSelectedToolkit(toolkit);
    setIsToolsPanelOpen(true);
  };

  const handleCloseToolsPanel = () => {
    setSelectedToolkit(null);
    setIsToolsPanelOpen(false);
  };

  const handleAddTool = (tool: z.infer<typeof WorkflowTool>) => {
    onAddTool(tool);
    handleCloseToolsPanel();
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs 
        selectedKey={activeTab}
        onSelectionChange={handleTabChange}
        aria-label="Tool configuration options"
        className="w-full"
        fullWidth
      >
        {useComposioTools && (
          <Tab key="composio" title="Composio">
            <div className="mt-4 p-6">
              <SelectComposioToolkit
                projectId={projectId}
                tools={tools}
                onSelectToolkit={handleSelectToolkit}
                initialToolkitSlug={initialToolkitSlug}
              />
            </div>
          </Tab>
        )}
        <Tab key="mcp" title="Custom MCP Servers">
          <div className="mt-4 p-6">
            <CustomMcpServers
              tools={tools}
              onAddTool={onAddTool}
            />
          </div>
        </Tab>
        <Tab key="webhook" title="Webhook">
          <div className="mt-4 p-6">
            <AddWebhookTool
              projectId={projectId}
              onAddTool={onAddTool}
            />
          </div>
        </Tab>
      </Tabs>
      
      {/* Tools Panel */}
      {selectedToolkit && (
        <ComposioToolsPanel
          toolkit={selectedToolkit}
          isOpen={isToolsPanelOpen}
          onClose={handleCloseToolsPanel}
          tools={tools}
          onAddTool={handleAddTool}
        />
      )}
    </div>
  );
} 
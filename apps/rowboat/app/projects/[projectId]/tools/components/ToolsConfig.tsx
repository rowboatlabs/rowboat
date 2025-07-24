'use client';

import { useState } from 'react';
import { Tabs, Tab } from '@/components/ui/tabs';
import { CustomMcpServers } from './CustomMcpServer';
import { Composio } from './Composio';
import { AddWebhookTool } from './AddWebhookTool';
import type { Key } from 'react';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';
import { z } from 'zod';

interface ToolsConfigProps {
  projectId: string;
  useComposioTools: boolean;
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: Partial<z.infer<typeof WorkflowTool>>) => void;
  initialToolkitSlug?: string | null;
}

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

  const handleTabChange = (key: Key) => {
    setActiveTab(key.toString());
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
              <Composio
                projectId={projectId}
                tools={tools}
                onAddTool={onAddTool}
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
    </div>
  );
} 
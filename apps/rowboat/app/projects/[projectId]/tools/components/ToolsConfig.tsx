'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HostedTools } from './HostedTools';
import { CustomServers } from './CustomServers';
import { WebhookConfig } from './WebhookConfig';

export function ToolsConfig() {
  const [activeTab, setActiveTab] = useState('hosted');

  return (
    <div className="h-full flex flex-col">
      <Tabs 
        value={activeTab} 
        onValueChange={setActiveTab} 
        className="flex-1 flex flex-col"
      >
        <TabsList className="grid w-full grid-cols-3 mb-8">
          <TabsTrigger value="hosted">Hosted MCP Servers</TabsTrigger>
          <TabsTrigger value="custom">Custom MCP Servers</TabsTrigger>
          <TabsTrigger value="webhook">Webhook</TabsTrigger>
        </TabsList>

        <div className="flex-1 p-6">
          <TabsContent value="hosted" className="mt-0 h-full">
            <HostedTools />
          </TabsContent>

          <TabsContent value="custom" className="mt-0 h-full">
            <CustomServers />
          </TabsContent>

          <TabsContent value="webhook" className="mt-0 h-full">
            <WebhookConfig />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
} 
'use client';

import { useState } from 'react';
import { Tabs, Tab } from '@/components/ui/tabs';
import { HostedServers } from './HostedServers';
import { CustomServers } from './CustomServers';
import { WebhookConfig } from './WebhookConfig';
import type { Key } from 'react';

export function ToolsConfig() {
  const [activeTab, setActiveTab] = useState('hosted');

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
        <Tab key="hosted" title="Tools Library">
          <div className="mt-4 p-6">
            <HostedServers />
          </div>
        </Tab>
        <Tab key="custom" title="Custom MCP Servers">
          <div className="mt-4 p-6">
            <CustomServers />
          </div>
        </Tab>
        <Tab key="webhook" title="Webhook">
          <div className="mt-4 p-6">
            <WebhookConfig />
          </div>
        </Tab>
      </Tabs>
    </div>
  );
} 
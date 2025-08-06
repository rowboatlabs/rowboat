'use client';

import React from 'react';
import { Card, CardBody, CardHeader } from '@heroui/react';
import { ZapIcon, CheckCircleIcon } from 'lucide-react';
import { z } from 'zod';
import { ZToolkit } from '@/app/lib/composio/composio';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';

interface TriggerConfigPlaceholderProps {
  toolkit: z.infer<typeof ZToolkit>;
  triggerType: z.infer<typeof ComposioTriggerType>;
}

export function TriggerConfigPlaceholder({
  toolkit,
  triggerType,
}: TriggerConfigPlaceholderProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className="relative">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <ZapIcon className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <CheckCircleIcon className="w-4 h-4 text-white" />
            </div>
          </div>
        </div>
        
        <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Welcome to Trigger Configuration!
        </h3>
        
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          You're all set to configure your trigger. The detailed configuration UI will be implemented next.
        </p>
      </div>

      <Card className="w-full">
        <CardHeader>
          <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Trigger Details
          </h4>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Toolkit:</span>
              <p className="text-base text-gray-900 dark:text-gray-100">{toolkit.name}</p>
            </div>
            
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Trigger Type:</span>
              <p className="text-base text-gray-900 dark:text-gray-100">{triggerType.name}</p>
            </div>
            
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Description:</span>
              <p className="text-base text-gray-900 dark:text-gray-100">{triggerType.description}</p>
            </div>
            
            {Object.keys(triggerType.config).length > 0 && (
              <div>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Configuration Schema:</span>
                <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-3 rounded-md overflow-auto">
                  {JSON.stringify(triggerType.config, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </CardBody>
      </Card>
      
      <div className="text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          🚧 Trigger configuration form coming soon! 🚧
        </p>
      </div>
    </div>
  );
}
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardBody, CardHeader, Spinner } from '@heroui/react';
import { ChevronLeft, ChevronRight, ZapIcon, ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';
import { listComposioTriggerTypes } from '@/app/actions/composio_actions';
import { ZToolkit } from '@/app/lib/composio/composio';

interface ComposioTriggerTypesPanelProps {
  toolkit: z.infer<typeof ZToolkit>;
  onBack: () => void;
  onSelectTriggerType: (triggerType: z.infer<typeof ComposioTriggerType>) => void;
}

type TriggerType = z.infer<typeof ComposioTriggerType>;

export function ComposioTriggerTypesPanel({
  toolkit,
  onBack,
  onSelectTriggerType,
}: ComposioTriggerTypesPanelProps) {
  const [triggerTypes, setTriggerTypes] = useState<TriggerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadTriggerTypes = useCallback(async (resetList = false, nextCursor?: string) => {
    try {
      if (resetList) {
        setLoading(true);
        setTriggerTypes([]);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      const response = await listComposioTriggerTypes(toolkit.slug, nextCursor);
      
      if (resetList) {
        setTriggerTypes(response.items);
      } else {
        setTriggerTypes(prev => [...prev, ...response.items]);
      }
      
      setCursor(response.nextCursor);
      setHasNextPage(!!response.nextCursor);
    } catch (err: any) {
      console.error('Error loading trigger types:', err);
      setError('Failed to load trigger types. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [toolkit.slug]);

  const handleLoadMore = () => {
    if (cursor && !loadingMore) {
      loadTriggerTypes(false, cursor);
    }
  };

  const handleTriggerTypeSelect = (triggerType: TriggerType) => {
    onSelectTriggerType(triggerType);
  };

  useEffect(() => {
    loadTriggerTypes(true);
  }, [loadTriggerTypes]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="light" isIconOnly onPress={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {toolkit.name} Triggers
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select a trigger type to set up
            </p>
          </div>
        </div>
        
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
          <span className="ml-2">Loading trigger types...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="light" isIconOnly onPress={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {toolkit.name} Triggers
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select a trigger type to set up
            </p>
          </div>
        </div>
        
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">{error}</p>
          <Button variant="flat" onPress={() => loadTriggerTypes(true)}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="light" isIconOnly onPress={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {toolkit.name} Triggers
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select a trigger type to set up ({triggerTypes.length} available)
          </p>
        </div>
      </div>

      {triggerTypes.length === 0 ? (
        <div className="text-center py-12">
          <ZapIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            No trigger types available
          </h3>
          <p className="text-gray-500 dark:text-gray-400">
            This toolkit doesn&apos;t have any trigger types configured.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {triggerTypes.map((triggerType) => (
              <Card 
                key={triggerType.slug} 
                className="cursor-pointer hover:shadow-md transition-shadow"
                isPressable
                onPress={() => handleTriggerTypeSelect(triggerType)}
              >
                <CardHeader className="flex gap-3">
                  <div className="flex items-center justify-center w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                    <ZapIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex flex-col">
                    <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {triggerType.name}
                    </p>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                    {triggerType.description}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <Button 
                      size="sm" 
                      variant="flat" 
                      color="primary"
                      onPress={() => handleTriggerTypeSelect(triggerType)}
                    >
                      Configure
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                variant="flat"
                onPress={handleLoadMore}
                isLoading={loadingMore}
                startContent={!loadingMore ? <ChevronRight className="w-4 h-4" /> : null}
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Card, CardBody, Spinner } from '@heroui/react';
import { ChevronLeft, ChevronRight, ZapIcon, ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';
import { listComposioTriggerTypes } from '@/app/actions/composio.actions';
import { ZToolkit } from "@/src/application/lib/composio/types";
import { PictureImg } from '@/components/ui/picture-img';

interface ComposioTriggerTypesPanelProps {
  toolkit: z.infer<typeof ZToolkit>;
  onBack: () => void;
  onSelectTriggerType: (triggerType: z.infer<typeof ComposioTriggerType>) => void;
  initialTriggerTypeSlug?: string | null;
}

type TriggerType = z.infer<typeof ComposioTriggerType>;

export function ComposioTriggerTypesPanel({
  toolkit,
  onBack,
  onSelectTriggerType,
  initialTriggerTypeSlug,
}: ComposioTriggerTypesPanelProps) {
  const [triggerTypes, setTriggerTypes] = useState<TriggerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoSelected, setAutoSelected] = useState(false);

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
    setAutoSelected(false);
  }, [loadTriggerTypes]);

  useEffect(() => {
    if (!initialTriggerTypeSlug || autoSelected || triggerTypes.length === 0) {
      return;
    }
    const match = triggerTypes.find(triggerType => triggerType.slug === initialTriggerTypeSlug);
    if (match) {
      setAutoSelected(true);
      onSelectTriggerType(match);
    }
  }, [initialTriggerTypeSlug, triggerTypes, onSelectTriggerType, autoSelected]);

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
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {triggerTypes.map((triggerType) => (
              <Card
                key={triggerType.slug}
                className="group p-6 rounded-xl transition-all duration-200 cursor-pointer bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-md dark:shadow-gray-900/20 hover:shadow-lg dark:hover:shadow-gray-900/30 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50/50 hover:-translate-y-1 min-h-[200px] flex flex-col"
                isPressable
                onPress={() => handleTriggerTypeSelect(triggerType)}
              >
                <div className="flex items-start gap-3 mb-2">
                  {toolkit.meta?.logo ? (
                    <PictureImg
                      src={toolkit.meta.logo}
                      alt={`${toolkit.name} logo`}
                      className="w-8 h-8 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-md">
                      <ZapIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate text-left">
                      {triggerType.name}
                    </h3>
                  </div>
                </div>
                <CardBody className="pt-0 px-0 flex-1 flex flex-col">
                  <div className="flex-1">
                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
                      {triggerType.description}
                    </p>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-end">
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

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalBody, ModalContent, ModalHeader } from '@heroui/react';
import { z } from 'zod';
import { ZToolkit } from '@/src/application/lib/composio/types';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';
import { Project } from '@/src/entities/models/project';
import { SelectComposioToolkit } from '../../tools/components/SelectComposioToolkit';
import { ComposioTriggerTypesPanel } from '../../workflow/components/ComposioTriggerTypesPanel';
import { TriggerConfigForm } from '../../workflow/components/TriggerConfigForm';
import { ToolkitAuthModal } from '../../tools/components/ToolkitAuthModal';
import { fetchProject } from '@/app/actions/project.actions';
import { createComposioTriggerDeployment } from '@/app/actions/composio.actions';
import { Button, Spinner } from '@heroui/react';

interface TriggerSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  initialToolkitSlug?: string | null;
  initialTriggerTypeSlug?: string | null;
  initialTriggerConfig?: Record<string, unknown> | null;
  onCreated?: () => void;
}

type Toolkit = z.infer<typeof ZToolkit>;
type TriggerType = z.infer<typeof ComposioTriggerType>;
type ProjectConfig = z.infer<typeof Project>;

export function TriggerSetupModal({
  isOpen,
  onClose,
  projectId,
  initialToolkitSlug = null,
  initialTriggerTypeSlug = null,
  initialTriggerConfig = null,
  onCreated,
}: TriggerSetupModalProps) {
  const [selectedToolkit, setSelectedToolkit] = useState<Toolkit | null>(null);
  const [selectedTriggerType, setSelectedTriggerType] = useState<TriggerType | null>(null);
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTriggerTypeSlug, setPendingTriggerTypeSlug] = useState<string | null>(null);
  const [initialConfig, setInitialConfig] = useState<Record<string, unknown> | undefined>();

  const loadProjectConfig = useCallback(async () => {
    try {
      const config = await fetchProject(projectId);
      setProjectConfig(config);
    } catch (err) {
      console.error('Failed to fetch project configuration', err);
    }
  }, [projectId]);

  const resetState = useCallback(() => {
    setSelectedToolkit(null);
    setSelectedTriggerType(null);
    setShowAuthModal(false);
    setError(null);
    setPendingTriggerTypeSlug(initialTriggerTypeSlug);
    setInitialConfig(initialTriggerConfig ?? undefined);
  }, [initialTriggerConfig, initialTriggerTypeSlug]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    resetState();
    void loadProjectConfig();
  }, [isOpen, loadProjectConfig, resetState]);

  const requiresAuth = useMemo(() => {
    if (!selectedToolkit) return false;
    return !selectedToolkit.no_auth;
  }, [selectedToolkit]);

  const hasActiveConnection = useMemo(() => {
    if (!selectedToolkit) return false;
    const status = projectConfig?.composioConnectedAccounts?.[selectedToolkit.slug]?.status;
    return status === 'ACTIVE';
  }, [projectConfig, selectedToolkit]);

  const handleSelectToolkit = useCallback((toolkit: Toolkit) => {
    setSelectedToolkit(toolkit);
    setSelectedTriggerType(null);
    setError(null);
    if (!initialToolkitSlug || toolkit.slug === initialToolkitSlug) {
      setPendingTriggerTypeSlug(initialTriggerTypeSlug);
    } else {
      setPendingTriggerTypeSlug(null);
    }
  }, [initialToolkitSlug, initialTriggerTypeSlug]);

  const handleSelectTriggerType = useCallback((triggerType: TriggerType) => {
    setSelectedTriggerType(triggerType);
    setError(null);
    setPendingTriggerTypeSlug(null);
    if (requiresAuth && !hasActiveConnection) {
      setShowAuthModal(true);
    }
  }, [requiresAuth, hasActiveConnection]);

  const handleAuthComplete = useCallback(async () => {
    await loadProjectConfig();
    setShowAuthModal(false);
  }, [loadProjectConfig]);

  const handleSubmit = useCallback(async (triggerConfig: Record<string, unknown>) => {
    if (!selectedToolkit || !selectedTriggerType) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const connectedAccountId = projectConfig?.composioConnectedAccounts?.[selectedToolkit.slug]?.id;
      if (!connectedAccountId) {
        setShowAuthModal(true);
        throw new Error('Connect this toolkit before creating a trigger.');
      }

      await createComposioTriggerDeployment({
        projectId,
        triggerTypeSlug: selectedTriggerType.slug,
        connectedAccountId,
        triggerConfig,
      });

      onCreated?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to create trigger', err);
      setError(err?.message || 'Failed to create trigger. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [onClose, onCreated, projectConfig, projectId, selectedToolkit, selectedTriggerType]);

  const handleClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }
    onClose();
  }, [isSubmitting, onClose]);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size="5xl"
        scrollBehavior="inside"
        classNames={{
          base: 'max-h-[90vh]'
        }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Set up External Trigger</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Follow the guided flow to authenticate and configure the trigger.
            </p>
          </ModalHeader>
          <ModalBody className="pb-6">
            {!selectedToolkit && (
              <SelectComposioToolkit
                key={isOpen ? 'toolkit-selector' : 'toolkit-selector-hidden'}
                projectId={projectId}
                tools={[]}
                onSelectToolkit={handleSelectToolkit}
                initialToolkitSlug={initialToolkitSlug}
                filterByTriggers={true}
              />
            )}

            {selectedToolkit && !selectedTriggerType && (
              <ComposioTriggerTypesPanel
                key={selectedToolkit.slug}
                toolkit={selectedToolkit}
                onBack={() => setSelectedToolkit(null)}
                onSelectTriggerType={handleSelectTriggerType}
                initialTriggerTypeSlug={pendingTriggerTypeSlug}
              />
            )}

            {selectedToolkit && selectedTriggerType && (!requiresAuth || hasActiveConnection) && (
              <div className="space-y-4">
                <div>
                  <Button variant="light" size="sm" onPress={() => setSelectedTriggerType(null)}>
                    Back
                  </Button>
                </div>
                <TriggerConfigForm
                  toolkit={selectedToolkit}
                  triggerType={selectedTriggerType}
                  onBack={() => setSelectedTriggerType(null)}
                  onSubmit={handleSubmit}
                  isSubmitting={isSubmitting}
                  initialConfig={initialConfig}
                />
              </div>
            )}

            {selectedToolkit && selectedTriggerType && requiresAuth && !hasActiveConnection && !showAuthModal && (
              <div className="py-12 text-center space-y-4">
                <Spinner className="mx-auto" />
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Waiting for authentication to complete...
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-3 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {selectedToolkit && (
        <ToolkitAuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          projectId={projectId}
          toolkitSlug={selectedToolkit.slug}
          onComplete={handleAuthComplete}
        />
      )}
    </>
  );
}

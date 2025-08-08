'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner, Card, CardBody, CardHeader } from '@heroui/react';
import { Plus, Trash2, ZapIcon } from 'lucide-react';
import { z } from 'zod';
import { ComposioTriggerDeployment } from '@/src/entities/models/composio-trigger-deployment';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';
import { listComposioTriggerDeployments, deleteComposioTriggerDeployment, createComposioTriggerDeployment } from '@/app/actions/composio_actions';
import { SelectComposioToolkit } from '../../tools/components/SelectComposioToolkit';
import { ComposioTriggerTypesPanel } from './ComposioTriggerTypesPanel';
import { TriggerConfigForm } from './TriggerConfigForm';
import { ToolkitAuthModal } from '../../tools/components/ToolkitAuthModal';
import { ZToolkit } from '@/app/lib/composio/composio';
import { Project } from '@/app/lib/types/project_types';

interface TriggersModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectConfig: z.infer<typeof Project>;
  onProjectConfigUpdated?: () => void;
}

type TriggerDeployment = z.infer<typeof ComposioTriggerDeployment>;

export function TriggersModal({
  isOpen,
  onClose,
  projectId,
  projectConfig,
  onProjectConfigUpdated,
}: TriggersModalProps) {
  const [triggers, setTriggers] = useState<TriggerDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateFlow, setShowCreateFlow] = useState(false);
  const [selectedToolkit, setSelectedToolkit] = useState<z.infer<typeof ZToolkit> | null>(null);
  const [selectedTriggerType, setSelectedTriggerType] = useState<z.infer<typeof ComposioTriggerType> | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSubmittingTrigger, setIsSubmittingTrigger] = useState(false);
  const [deletingTrigger, setDeletingTrigger] = useState<string | null>(null);

  const loadTriggers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await listComposioTriggerDeployments({ projectId });
      setTriggers(response.items);
    } catch (err: any) {
      console.error('Error loading triggers:', err);
      setError('Failed to load triggers. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleDeleteTrigger = async (deploymentId: string) => {
    if (!window.confirm('Are you sure you want to delete this trigger?')) {
      return;
    }

    try {
      setDeletingTrigger(deploymentId);
      await deleteComposioTriggerDeployment({ projectId, deploymentId });
      await loadTriggers(); // Reload the list
    } catch (err: any) {
      console.error('Error deleting trigger:', err);
      setError('Failed to delete trigger. Please try again.');
    } finally {
      setDeletingTrigger(null);
    }
  };

  const handleCreateNew = () => {
    setShowCreateFlow(true);
  };

  const handleBackToList = () => {
    setShowCreateFlow(false);
    setSelectedToolkit(null);
    setSelectedTriggerType(null);
    setShowAuthModal(false);
    setIsSubmittingTrigger(false);
    loadTriggers(); // Reload in case any triggers were created
  };

  const handleSelectToolkit = (toolkit: z.infer<typeof ZToolkit>) => {
    setSelectedToolkit(toolkit);
  };

  const handleBackToToolkitSelection = () => {
    setSelectedToolkit(null);
    setSelectedTriggerType(null);
    setIsSubmittingTrigger(false);
  };

  const handleSelectTriggerType = (triggerType: z.infer<typeof ComposioTriggerType>) => {
    if (!selectedToolkit) return;
    
    setSelectedTriggerType(triggerType);
    
    // Check if toolkit requires auth and if connected account exists
    const needsAuth = !selectedToolkit.no_auth;
    const hasConnection = projectConfig?.composioConnectedAccounts?.[selectedToolkit.slug]?.status === 'ACTIVE';
    
    if (needsAuth && !hasConnection) {
      // Show auth modal
      setShowAuthModal(true);
    } else {
      // Proceed to trigger configuration
      // For now this is just the placeholder, but will be actual config later
    }
  };

  const handleAuthComplete = async () => {
    setShowAuthModal(false);
    onProjectConfigUpdated?.();
  };

  const handleTriggerSubmit = async (triggerConfig: Record<string, unknown>) => {
    if (!selectedToolkit || !selectedTriggerType) return;

    try {
      setIsSubmittingTrigger(true);
      
      // Get the connected account ID for this toolkit
      const connectedAccountId = projectConfig?.composioConnectedAccounts?.[selectedToolkit.slug]?.id;
      
      if (!connectedAccountId) {
        throw new Error('No connected account found for this toolkit');
      }

      // Create the trigger deployment
      await createComposioTriggerDeployment({
        projectId,
        toolkitSlug: selectedToolkit.slug,
        triggerTypeSlug: selectedTriggerType.slug,
        connectedAccountId,
        triggerConfig,
      });

      // Success! Go back to triggers list and reload
      handleBackToList();
    } catch (err: any) {
      console.error('Error creating trigger:', err);
      setError('Failed to create trigger. Please try again.');
    } finally {
      setIsSubmittingTrigger(false);
    }
  };

  useEffect(() => {
    if (isOpen && !showCreateFlow) {
      loadTriggers();
    }
  }, [isOpen, showCreateFlow, loadTriggers]);

  const renderTriggerList = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <Spinner size="lg" />
          <span className="ml-2">Loading triggers...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-8">
          <p className="text-red-500 mb-4">{error}</p>
          <Button variant="flat" onPress={loadTriggers}>
            Try Again
          </Button>
        </div>
      );
    }

    if (triggers.length === 0) {
      return (
        <div className="text-center py-12">
          <ZapIcon className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            No triggers configured
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Set up your first trigger to listen for events from your connected apps.
          </p>
          <Button
            color="primary"
            variant="solid"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleCreateNew}
          >
            Create your first trigger
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Active Triggers ({triggers.length})
          </h3>
          <Button
            color="primary"
            variant="solid"
            startContent={<Plus className="w-4 h-4" />}
            onPress={handleCreateNew}
          >
            Create New Trigger
          </Button>
        </div>

        <div className="space-y-3">
          {triggers.map((trigger) => (
            <Card key={trigger.id} className="w-full">
              <CardHeader className="flex justify-between items-start">
                <div>
                  <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">
                    {trigger.triggerTypeSlug}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Created {new Date(trigger.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  isIconOnly
                  variant="light"
                  color="danger"
                  size="sm"
                  isLoading={deletingTrigger === trigger.id}
                  onPress={() => handleDeleteTrigger(trigger.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  <p><strong>Trigger ID:</strong> {trigger.triggerId}</p>
                  <p><strong>Connected Account:</strong> {trigger.connectedAccountId}</p>
                  {Object.keys(trigger.triggerConfig).length > 0 && (
                    <div className="mt-2">
                      <strong>Configuration:</strong>
                      <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded">
                        {JSON.stringify(trigger.triggerConfig, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const renderCreateFlow = () => {
    // If trigger type is selected and auth is complete, show config
    if (selectedToolkit && selectedTriggerType && !showAuthModal) {
      const needsAuth = !selectedToolkit.no_auth;
      const hasConnection = projectConfig?.composioConnectedAccounts?.[selectedToolkit.slug]?.status === 'ACTIVE';
      
      if (!needsAuth || hasConnection) {
        return (
          <TriggerConfigForm
            toolkit={selectedToolkit}
            triggerType={selectedTriggerType}
            onBack={handleBackToToolkitSelection}
            onSubmit={handleTriggerSubmit}
            isSubmitting={isSubmittingTrigger}
          />
        );
      }
    }

    // If no toolkit selected, show toolkit selection
    if (!selectedToolkit) {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Select a Toolkit to Create Trigger
            </h3>
            <Button
              variant="flat"
              onPress={handleBackToList}
            >
              ← Back to Triggers
            </Button>
          </div>

          <SelectComposioToolkit
            projectId={projectId}
            tools={[]} // Empty array since we're not using this for tools
            onSelectToolkit={handleSelectToolkit}
            initialToolkitSlug={null}
          />
        </div>
      );
    }

    // If toolkit selected, show trigger types
    return (
      <div className="space-y-4">
        <ComposioTriggerTypesPanel
          toolkit={selectedToolkit}
          onBack={handleBackToToolkitSelection}
          onSelectTriggerType={handleSelectTriggerType}
        />
      </div>
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalContent className="max-h-[90vh]">
          <ModalHeader>
            <div className="flex items-center gap-2">
              <ZapIcon className="w-5 h-5" />
              <span>Manage Triggers</span>
            </div>
          </ModalHeader>
          <ModalBody>
            {showCreateFlow ? renderCreateFlow() : renderTriggerList()}
          </ModalBody>
          {!showCreateFlow && (
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>
      
      {/* Auth Modal */}
      {selectedToolkit && (
        <ToolkitAuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          toolkitSlug={selectedToolkit.slug}
          projectId={projectId}
          onComplete={handleAuthComplete}
        />
      )}
    </>
  );
}
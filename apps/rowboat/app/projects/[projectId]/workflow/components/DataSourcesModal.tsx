'use client';

import React, { useState, useEffect } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { Button } from '@/components/ui/button';
import { Form } from '../../sources/new/form';
import { FilesSource } from '../../sources/components/files-source';
import { getDataSource } from '../../../../actions/datasource_actions';
import { WithStringId } from '../../../../lib/types/types';
import { DataSource } from '../../../../lib/types/datasource_types';
import { z } from 'zod';

interface DataSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onDataSourceAdded?: () => void;
  useRagUploads: boolean;
  useRagS3Uploads: boolean;
  useRagScraping: boolean;
}

export function DataSourcesModal({
  isOpen,
  onClose,
  projectId,
  onDataSourceAdded,
  useRagUploads,
  useRagS3Uploads,
  useRagScraping
}: DataSourcesModalProps) {
  const [currentView, setCurrentView] = useState<'form' | 'upload'>('form');
  const [createdSource, setCreatedSource] = useState<WithStringId<z.infer<typeof DataSource>> | null>(null);

  const handleDataSourceCreated = async (sourceId: string) => {
    // Get the created data source
    const source = await getDataSource(projectId, sourceId);
    
    // If it's a files data source, show the upload interface
    if (source.data.type === 'files_local' || source.data.type === 'files_s3') {
      setCreatedSource(source);
      setCurrentView('upload');
    } else {
      // For other types (text, urls), close the modal
      onDataSourceAdded?.();
      onClose();
    }
  };

  const handleFilesUploaded = () => {
    // Just refresh the data sources list, don't close the modal
    // User can continue uploading more files or close manually
    onDataSourceAdded?.();
  };

  const handleModalClose = () => {
    setCurrentView('form');
    setCreatedSource(null);
    onClose();
  };

  // Reset view when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentView('form');
      setCreatedSource(null);
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>
          <h3 className="text-lg font-semibold">
            {currentView === 'form' ? 'Add data source' : 'Upload files'}
          </h3>
        </ModalHeader>
        <ModalBody>
          {currentView === 'form' ? (
            <Form
              projectId={projectId}
              useRagUploads={useRagUploads}
              useRagS3Uploads={useRagS3Uploads}
              useRagScraping={useRagScraping}
              onSuccess={handleDataSourceCreated}
              hidePanel={true}
            />
          ) : (
            createdSource && (
              <FilesSource
                projectId={projectId}
                dataSource={createdSource}
                handleReload={handleFilesUploaded}
                type={createdSource.data.type as 'files_local' | 'files_s3'}
              />
            )
          )}
        </ModalBody>
        {currentView === 'upload' && (
          <ModalFooter>
            <Button
              variant="primary"
              onClick={handleModalClose}
            >
              Done
            </Button>
          </ModalFooter>
        )}
      </ModalContent>
    </Modal>
  );
}
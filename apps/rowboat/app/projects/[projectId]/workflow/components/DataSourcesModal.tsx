'use client';

import React from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react';
import { Form } from '../../sources/new/form';

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
  const handleDataSourceCreated = (sourceId: string) => {
    onDataSourceAdded?.();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>
          <h3 className="text-lg font-semibold">
            Add data source
          </h3>
        </ModalHeader>
        <ModalBody>
          <Form
            projectId={projectId}
            useRagUploads={useRagUploads}
            useRagS3Uploads={useRagS3Uploads}
            useRagScraping={useRagScraping}
            onSuccess={handleDataSourceCreated}
            hidePanel={true}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
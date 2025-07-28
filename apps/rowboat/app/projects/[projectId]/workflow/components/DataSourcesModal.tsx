'use client';

import React from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react';
import { Form } from '../../sources/new/form';
import { USE_RAG_UPLOADS, USE_RAG_S3_UPLOADS, USE_RAG_SCRAPING } from '@/app/lib/feature_flags';

interface DataSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onDataSourceAdded?: () => void;
}

export function DataSourcesModal({
  isOpen,
  onClose,
  projectId,
  onDataSourceAdded
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
            useRagUploads={USE_RAG_UPLOADS}
            useRagS3Uploads={USE_RAG_S3_UPLOADS}
            useRagScraping={USE_RAG_SCRAPING}
            onSuccess={handleDataSourceCreated}
            hidePanel={true}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
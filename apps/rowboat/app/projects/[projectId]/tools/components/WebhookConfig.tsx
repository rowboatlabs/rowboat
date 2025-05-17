'use client';

import { WebhookUrlSection } from '../../config/components/tools';
import { useParams } from 'next/navigation';

export function WebhookConfig() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId[0];
  
  return (
    <div className="space-y-6">
      <WebhookUrlSection projectId={projectId} />
    </div>
  );
} 
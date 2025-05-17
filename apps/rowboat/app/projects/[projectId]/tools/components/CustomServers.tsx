'use client';

import { McpServersSection } from '../../config/components/tools';
import { useParams } from 'next/navigation';

export function CustomServers() {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId[0];
  
  return (
    <div className="space-y-6">
      <McpServersSection projectId={projectId} />
    </div>
  );
} 
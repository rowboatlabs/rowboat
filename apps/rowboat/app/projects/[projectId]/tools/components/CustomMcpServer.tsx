'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@heroui/react';
import { Input } from '@/components/ui/input';
import { Info, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import { Workflow, WorkflowTool } from '@/app/lib/types/workflow_types';
import { fetchProject } from '@/app/actions/project.actions';
import { addServer, removeServer } from '@/app/actions/custom-mcp-server.actions';
import { fetchTools } from "@/app/actions/custom-mcp-server.actions";
import { ServerCard } from './ServerCard';
import { McpToolsPanel } from './McpToolsPanel';
import { ProjectWideChangeConfirmationModal } from '@/components/common/project-wide-change-confirmation-modal';

// Types
const CustomMcpServerType = z.object({ serverUrl: z.string() });
type CustomMcpServer = z.infer<typeof CustomMcpServerType>;

type ServerList = Record<string, CustomMcpServer>;

type CustomMcpServersProps = {
  tools: z.infer<typeof Workflow.shape.tools>;
  onAddTool: (tool: z.infer<typeof WorkflowTool>) => void;
};

export function CustomMcpServers({ tools: workflowTools, onAddTool }: CustomMcpServersProps) {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');

  // State
  const [servers, setServers] = useState<ServerList>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [panelServer, setPanelServer] = useState<{ name: string; url: string } | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<z.infer<typeof WorkflowTool>[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);

  // Fetch servers on mount
  const fetchServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const project = await fetchProject(projectId);
      setServers(project.customMcpServers || {});
    } catch (err: any) {
      setError(err?.message || 'Failed to load servers');
      setServers({});
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  // Add server
  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addName || !addUrl) return;
    setAddLoading(true);
    setAddError(null);
    try {
      await addServer(projectId, addName, { serverUrl: addUrl });
      setAddName('');
      setAddUrl('');
      await fetchServers();
    } catch (err: any) {
      setAddError(err?.message || 'Failed to add server');
    } finally {
      setAddLoading(false);
    }
  };

  // Open delete modal
  const handleDeleteClick = (name: string) => {
    setServerToDelete(name);
    setDeleteModalOpen(true);
  };

  // Delete server
  const handleDeleteServer = async () => {
    if (!serverToDelete) return;
    try {
      await removeServer(projectId, serverToDelete);
      await fetchServers();
      setDeleteModalOpen(false);
      setServerToDelete(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to delete server');
    }
  };

  // Open panel and fetch tools
  const handleOpenPanel = async (name: string, url: string) => {
    setPanelServer({ name, url });
    setToolsLoading(true);
    setToolsError(null);
    setServerTools([]);
    try {
      const fetched = await fetchTools(url, name);
      setServerTools(fetched);
    } catch (err: any) {
      setToolsError(err?.message || 'Failed to fetch tools');
    } finally {
      setToolsLoading(false);
    }
  };

  // Close panel
  const handleClosePanel = () => {
    setPanelServer(null);
    setServerTools([]);
  };

  // UI
  return (
    <div className="space-y-6">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-3">
          <div className="shrink-0">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Add your own MCP servers here. Enter the server details and select tools to add to your workflow.
          </p>
        </div>
      </div>

      {/* Add server form */}
      <form onSubmit={handleAddServer} className="space-y-4">
        <div className="flex gap-4">
          <Input
            type="text"
            value={addName}
            onChange={e => setAddName(e.target.value)}
            placeholder="Server Name"
            required
            className="flex-1"
          />
          <Input
            type="text"
            value={addUrl}
            onChange={e => setAddUrl(e.target.value)}
            placeholder="Server URL"
            required
            className="flex-1"
          />
          <Button 
            type="submit" 
            disabled={!addName || !addUrl || addLoading}
            startContent={<Plus className="h-4 w-4" />}
          >
            Add
          </Button>
        </div>
        {addError && <div className="text-red-500 text-sm mt-1">{addError}</div>}
      </form>

      {/* Server cards */}
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-800 dark:border-gray-200 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">Loading servers...</p>
        </div>
      ) : error ? (
        <div className="text-center py-8 text-red-500 dark:text-red-400">{error}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(servers).length === 0 ? (
            <div className="col-span-full text-gray-500 text-sm">No custom MCP servers added yet.</div>
          ) : (
            Object.entries(servers).map(([name, { serverUrl }]) => (
              <ServerCard
                key={name}
                serverName={name}
                serverUrl={serverUrl}
                workflowTools={workflowTools}
                onSelectServer={() => handleOpenPanel(name, serverUrl)}
                onDeleteServer={() => handleDeleteClick(name)}
              />
            ))
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      <ProjectWideChangeConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteServer}
        title="Delete Server"
        confirmationQuestion={`Are you sure you want to delete "${serverToDelete}"? This will delete the server from the project.`}
        confirmButtonText="Delete"
      />

      {/* MCP Tools Panel */}
      <McpToolsPanel
        server={panelServer}
        isOpen={!!panelServer}
        onClose={handleClosePanel}
        tools={workflowTools}
        onAddTool={onAddTool}
        serverTools={serverTools}
        toolsLoading={toolsLoading}
        toolsError={toolsError}
      />
    </div>
  );
} 
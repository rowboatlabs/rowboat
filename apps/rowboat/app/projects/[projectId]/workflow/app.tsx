"use client";
import { MCPServer, WithStringId } from "../../../lib/types/types";
import { DataSource } from "@/src/entities/models/data-source";
import { Project } from "@/src/entities/models/project";
import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { WorkflowEditor } from "./workflow_editor";
import { Spinner } from "@heroui/react";
import { listDataSources } from "../../../actions/data-source.actions";
import { revertToLiveWorkflow } from "@/app/actions/project.actions";
import { fetchProject } from "@/app/actions/project.actions";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { getEligibleModels } from "@/app/actions/billing.actions";
import { ModelsResponse } from "@/app/lib/types/billing_types";

export function App({
    projectId,
    useRag,
    useRagUploads,
    useRagS3Uploads,
    useRagScraping,
    defaultModel,
    chatWidgetHost,
}: {
    projectId: string;
    useRag: boolean;
    useRagUploads: boolean;
    useRagS3Uploads: boolean;
    useRagScraping: boolean;
    defaultModel: string;
    chatWidgetHost: string;
}) {
    const [mode, setMode] = useState<'draft' | 'live'>('draft');
    const [project, setProject] = useState<z.infer<typeof Project> | null>(null);
    const [dataSources, setDataSources] = useState<z.infer<typeof DataSource>[] | null>(null);
    const [projectConfig, setProjectConfig] = useState<z.infer<typeof Project> | null>(null);
    const [loading, setLoading] = useState(false);
    const [eligibleModels, setEligibleModels] = useState<z.infer<typeof ModelsResponse> | "*">("*");
    const [projectMcpServers, setProjectMcpServers] = useState<Array<z.infer<typeof MCPServer>>>([]);

    console.log('workflow app.tsx render');

    // choose which workflow to display
    let workflow: z.infer<typeof Workflow> | undefined = project?.draftWorkflow;
    if (mode == 'live') {
        workflow = project?.liveWorkflow;
    }

    const loadData = useCallback(async () => {
        setLoading(true);
        const [
            project,
            dataSources,
            eligibleModels,
        ] = await Promise.all([
            fetchProject(projectId),
            listDataSources(projectId),
            getEligibleModels(),
        ]);

        setProject(project);
        setDataSources(dataSources);
        setEligibleModels(eligibleModels);
        if (project.mcpServers) {
            setProjectMcpServers(project.mcpServers);
        }
        setLoading(false);
    }, [projectId]);

    const handleProjectToolsUpdate = useCallback(async () => {
        // Lightweight refresh for tool-only updates
        const projectConfig = await fetchProject(projectId);
        
        setProject(projectConfig);
        setProjectConfig(projectConfig);
        
        // Update MCP servers if they changed
        if (projectConfig.mcpServers) {
            setProjectMcpServers(projectConfig.mcpServers);
        }
    }, [projectId]);

    const handleDataSourcesUpdate = useCallback(async () => {
        // Refresh data sources
        const updatedDataSources = await listDataSources(projectId);
        setDataSources(updatedDataSources);
    }, [projectId]);

    const handleProjectConfigUpdate = useCallback(async () => {
        // Refresh project config when project name or other settings change
        const updatedProjectConfig = await fetchProject(projectId);
        setProject(updatedProjectConfig);
        setProjectConfig(updatedProjectConfig);
    }, [projectId]);

    // Auto-update data sources when there are pending ones
    useEffect(() => {
        if (!dataSources) return;
        
        const hasPendingSources = dataSources.some(ds => ds.status === 'pending');
        if (!hasPendingSources) return;

        const interval = setInterval(async () => {
            const updatedDataSources = await listDataSources(projectId);
            setDataSources(updatedDataSources);
            
            // Stop polling if no more pending sources
            const stillHasPending = updatedDataSources.some(ds => ds.status === 'pending');
            if (!stillHasPending) {
                clearInterval(interval);
            }
        }, 7000); // Poll every 7 seconds (reduced from 3)

        return () => clearInterval(interval);
    }, [dataSources, projectId]);
    // Add this useEffect for initial load
    useEffect(() => {
        loadData();
    }, [mode, loadData, projectId]);

    function handleSetMode(mode: 'draft' | 'live') {
        setMode(mode);
    }

    async function handleRevertToLive() {
        setLoading(true);
        await revertToLiveWorkflow(projectId);
        loadData();
    }

    // if workflow is null, show the selector
    // else show workflow editor
    return <>
        {loading && <div className="flex items-center gap-1">
            <Spinner size="sm" />
            <div>Loading workflow...</div>
        </div>}
        {!loading && !workflow && <div>No workflow found!</div>}
        {!loading && project && workflow && (dataSources !== null) && <WorkflowEditor
            projectId={projectId}
            isLive={mode == 'live'}
            workflow={workflow}
            dataSources={dataSources}
            projectConfig={projectConfig || project}
            useRag={useRag}
            useRagUploads={useRagUploads}
            useRagS3Uploads={useRagS3Uploads}
            useRagScraping={useRagScraping}
            mcpServerUrls={projectMcpServers}
            defaultModel={defaultModel}
            eligibleModels={eligibleModels}
            onChangeMode={handleSetMode}
            onRevertToLive={handleRevertToLive}
            onProjectToolsUpdated={handleProjectToolsUpdate}
            onDataSourcesUpdated={handleDataSourcesUpdate}
            onProjectConfigUpdated={handleProjectConfigUpdate}
            chatWidgetHost={chatWidgetHost}
        />}
    </>
}

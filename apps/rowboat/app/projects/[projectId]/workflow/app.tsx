"use client";
import { WithStringId } from "../../../lib/types/types";
import { DataSource } from "../../../lib/types/datasource_types";
import { Project } from "../../../lib/types/project_types";
import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { WorkflowEditor } from "./workflow_editor";
import { Spinner } from "@heroui/react";
import { listDataSources } from "../../../actions/datasource_actions";
import { collectProjectTools, revertToLiveWorkflow } from "@/app/actions/project_actions";
import { getProjectConfig } from "@/app/actions/project_actions";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { getEligibleModels } from "@/app/actions/billing_actions";
import { ModelsResponse } from "@/app/lib/types/billing_types";

export function App({
    projectId,
    useRag,
    defaultModel,
}: {
    projectId: string;
    useRag: boolean;
    defaultModel: string;
}) {
    const [mode, setMode] = useState<'draft' | 'live'>('draft');
    const [project, setProject] = useState<WithStringId<z.infer<typeof Project>> | null>(null);
    const [dataSources, setDataSources] = useState<WithStringId<z.infer<typeof DataSource>>[] | null>(null);
    const [projectTools, setProjectTools] = useState<z.infer<typeof WorkflowTool>[] | null>(null);
    const [projectConfig, setProjectConfig] = useState<z.infer<typeof Project> | null>(null);
    const [loading, setLoading] = useState(false);
    const [eligibleModels, setEligibleModels] = useState<z.infer<typeof ModelsResponse> | "*">("*");

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
            projectTools,
            eligibleModels,
        ] = await Promise.all([
            getProjectConfig(projectId),
            listDataSources(projectId),
            collectProjectTools(projectId),
            getEligibleModels(),
        ]);

        setProject(project);
        setDataSources(dataSources);
        setProjectTools(projectTools);
        setEligibleModels(eligibleModels);
        setLoading(false);
    }, [projectId]);

    const handleProjectToolsUpdate = useCallback(async () => {
        const [freshProjectConfig, freshProjectTools] = await Promise.all([
            getProjectConfig(projectId),
            collectProjectTools(projectId)
        ]);
        setProject(freshProjectConfig);
        setProjectConfig(freshProjectConfig);
        setProjectTools(freshProjectTools);
    }, [projectId]);
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
        {!loading && project && workflow && (dataSources !== null) && (projectTools !== null) && <WorkflowEditor
            key={project._id}
            projectId={projectId}
            isLive={mode == 'live'}
            workflow={workflow}
            dataSources={dataSources}
            projectTools={projectTools}
            projectConfig={projectConfig || project}
            useRag={useRag}
            mcpServerUrls={(projectConfig || project).mcpServers || []}
            toolWebhookUrl={(projectConfig || project).webhookUrl || ''}
            defaultModel={defaultModel}
            eligibleModels={eligibleModels}
            onChangeMode={handleSetMode}
            onRevertToLive={handleRevertToLive}
            onProjectToolsUpdated={handleProjectToolsUpdate}
        />}
    </>
}

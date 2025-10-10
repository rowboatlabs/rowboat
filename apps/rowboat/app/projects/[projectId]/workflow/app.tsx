"use client";
import { DataSource } from "@/src/entities/models/data-source";
import { TriggerSchemaForCopilot } from "@/src/entities/models/copilot";
import { Project } from "@/src/entities/models/project";
import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { WorkflowEditor } from "./workflow_editor";
import { Spinner } from "@heroui/react";
import { listDataSources } from "../../../actions/data-source.actions";
import { revertToLiveWorkflow } from "@/app/actions/project.actions";
import { fetchProject } from "@/app/actions/project.actions";
import { Workflow } from "@/app/lib/types/workflow_types";
import { ModelsResponse } from "@/app/lib/types/billing_types";
import { listScheduledJobRules } from "@/app/actions/scheduled-job-rules.actions";
import { listRecurringJobRules } from "@/app/actions/recurring-job-rules.actions";
import { listComposioTriggerDeployments } from "@/app/actions/composio.actions";
import { transformTriggersForCopilot, DEFAULT_TRIGGER_FETCH_LIMIT } from "./trigger-transform";

export function App({
    initialProjectData,
    initialDataSources,
    initialTriggers,
    eligibleModels,
    useRag,
    useRagUploads,
    useRagS3Uploads,
    useRagScraping,
    defaultModel,
    chatWidgetHost,
}: {
    initialProjectData: z.infer<typeof Project>;
    initialDataSources: z.infer<typeof DataSource>[];
    initialTriggers: z.infer<typeof TriggerSchemaForCopilot>[];
    eligibleModels: z.infer<typeof ModelsResponse> | "*";
    useRag: boolean;
    useRagUploads: boolean;
    useRagS3Uploads: boolean;
    useRagScraping: boolean;
    defaultModel: string;
    chatWidgetHost: string;
}) {
    const [mode, setMode] = useState<'draft' | 'live'>(() => {
        if (typeof window === 'undefined') return 'draft';
        const stored = window.localStorage.getItem(`workflow_mode_${initialProjectData.id}`);
        return stored === 'live' || stored === 'draft' ? stored : 'draft';
    });
    const [autoPublishEnabled, setAutoPublishEnabled] = useState(() => {
        if (typeof window === 'undefined') return true; // Default to auto-publish
        const stored = window.localStorage.getItem(`auto_publish_${initialProjectData.id}`);
        return stored !== null ? stored === 'true' : true;
    });
    const [project, setProject] = useState<z.infer<typeof Project>>(initialProjectData);
    const [dataSources, setDataSources] = useState<z.infer<typeof DataSource>[]>(initialDataSources);
    const [triggers, setTriggers] = useState<z.infer<typeof TriggerSchemaForCopilot>[]>(initialTriggers);
    const [loading, setLoading] = useState(false);

    console.log('workflow app.tsx render');

    const handleToggleAutoPublish = (enabled: boolean) => {
        setAutoPublishEnabled(enabled);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(`auto_publish_${initialProjectData.id}`, enabled.toString());
        }
    };

    // choose which workflow to display
    let workflow: z.infer<typeof Workflow> | undefined;
    if (autoPublishEnabled) {
        // In auto-publish mode, always use draft (since they're synced)
        workflow = project?.draftWorkflow;
    } else {
        // Manual mode: use current logic
        workflow = mode === 'live' ? project?.liveWorkflow : project?.draftWorkflow;
    }

    const fetchTriggers = useCallback(async () => {
        const [scheduled, recurring, composio] = await Promise.all([
            listScheduledJobRules({ projectId: initialProjectData.id, limit: DEFAULT_TRIGGER_FETCH_LIMIT }),
            listRecurringJobRules({ projectId: initialProjectData.id, limit: DEFAULT_TRIGGER_FETCH_LIMIT }),
            listComposioTriggerDeployments({ projectId: initialProjectData.id, limit: DEFAULT_TRIGGER_FETCH_LIMIT }),
        ]);

        return transformTriggersForCopilot({
            scheduled: scheduled.items ?? [],
            recurring: recurring.items ?? [],
            composio: composio.items ?? [],
        });
    }, [initialProjectData.id]);

    const refreshTriggers = useCallback(async () => {
        const nextTriggers = await fetchTriggers();
        setTriggers(nextTriggers);
    }, [fetchTriggers]);

    const reloadData = useCallback(async () => {
        setLoading(true);
        try {
            const [projectData, sourcesData, triggerData] = await Promise.all([
                fetchProject(initialProjectData.id),
                listDataSources(initialProjectData.id),
                fetchTriggers(),
            ]);

            setProject(projectData);
            setDataSources(sourcesData);
            setTriggers(triggerData);
        } finally {
            setLoading(false);
        }
    }, [fetchTriggers, initialProjectData.id]);

    const handleProjectToolsUpdate = useCallback(async () => {
        // Lightweight refresh for tool-only updates
        const projectConfig = await fetchProject(initialProjectData.id);
        
        setProject(projectConfig);
    }, [initialProjectData.id]);

    const handleDataSourcesUpdate = useCallback(async () => {
        // Refresh data sources
        const updatedDataSources = await listDataSources(initialProjectData.id);
        setDataSources(updatedDataSources);
    }, [initialProjectData.id]);

    const handleProjectConfigUpdate = useCallback(async () => {
        // Refresh project config when project name or other settings change
        const updatedProjectConfig = await fetchProject(initialProjectData.id);
        setProject(updatedProjectConfig);
    }, [initialProjectData.id]);

    // Auto-update data sources when there are pending ones
    useEffect(() => {
        if (!dataSources) return;
        
        const hasPendingSources = dataSources.some(ds => ds.status === 'pending');
        if (!hasPendingSources) return;

        const interval = setInterval(async () => {
            const updatedDataSources = await listDataSources(initialProjectData.id);
            setDataSources(updatedDataSources);
            
            // Stop polling if no more pending sources
            const stillHasPending = updatedDataSources.some(ds => ds.status === 'pending');
            if (!stillHasPending) {
                clearInterval(interval);
            }
        }, 7000); // Poll every 7 seconds (reduced from 3)

        return () => clearInterval(interval);
    }, [dataSources, initialProjectData.id]);

    function handleSetMode(mode: 'draft' | 'live') {
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(`workflow_mode_${initialProjectData.id}`, mode);
            }
        } catch {}
        setMode(mode);
        // Reload data to ensure we have the latest workflow data for the current mode
        reloadData();
    }

    async function handleRevertToLive() {
        setLoading(true);
        try {
            await revertToLiveWorkflow(initialProjectData.id);
            await reloadData();
        } finally {
            setLoading(false);
        }
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
            projectId={initialProjectData.id}
            isLive={mode == 'live'}
            autoPublishEnabled={autoPublishEnabled}
            onToggleAutoPublish={handleToggleAutoPublish}
            workflow={workflow}
            dataSources={dataSources}
            triggers={triggers}
            projectConfig={project}
            useRag={useRag}
            useRagUploads={useRagUploads}
            useRagS3Uploads={useRagS3Uploads}
            useRagScraping={useRagScraping}
            defaultModel={defaultModel}
            eligibleModels={eligibleModels}
            onChangeMode={handleSetMode}
            onRevertToLive={handleRevertToLive}
            onProjectToolsUpdated={handleProjectToolsUpdate}
            onDataSourcesUpdated={handleDataSourcesUpdate}
            onProjectConfigUpdated={handleProjectConfigUpdate}
            onTriggersUpdated={refreshTriggers}
            chatWidgetHost={chatWidgetHost}
        />}
    </>
}

"use client";
import { WithStringId } from "../../../lib/types/types";
import { Workflow } from "../../../lib/types/workflow_types";
import { DataSource } from "../../../lib/types/datasource_types";
import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { WorkflowEditor } from "./workflow_editor";
import { WorkflowSelector } from "./workflow_selector";
import { Spinner } from "@nextui-org/react";
import { cloneWorkflow, createWorkflow, fetchPublishedWorkflowId, fetchWorkflow } from "../../../actions/workflow_actions";
import { listDataSources } from "../../../actions/datasource_actions";
import { TestProfile } from "@/app/lib/types/testing_types";
import { getDefaultProfile } from "../../../actions/testing_actions";

export function App({
    projectId,
}: {
    projectId: string;
}) {
    const [selectorKey, setSelectorKey] = useState(0);
    const [workflow, setWorkflow] = useState<WithStringId<z.infer<typeof Workflow>> | null>(null);
    const [publishedWorkflowId, setPublishedWorkflowId] = useState<string | null>(null);
    const [dataSources, setDataSources] = useState<WithStringId<z.infer<typeof DataSource>>[] | null>(null);
    const [defaultTestProfile, setDefaultTestProfile] = useState<z.infer<typeof TestProfile> | null>(null);
    const [loading, setLoading] = useState(false);
    const [autoSelectIfOnlyOneWorkflow, setAutoSelectIfOnlyOneWorkflow] = useState(true);

    const handleSelect = useCallback(async (workflowId: string) => {
        setLoading(true);
        const workflow = await fetchWorkflow(projectId, workflowId);
        const publishedWorkflowId = await fetchPublishedWorkflowId(projectId);
        const dataSources = await listDataSources(projectId);
        const defaultTestProfile = await getDefaultProfile(projectId);
        // Store the selected workflow ID in local storage
        localStorage.setItem(`lastWorkflowId_${projectId}`, workflowId);
        setWorkflow(workflow);
        setPublishedWorkflowId(publishedWorkflowId);
        setDataSources(dataSources);
        setDefaultTestProfile(defaultTestProfile);
        setLoading(false);
    }, [projectId]);

    function handleShowSelector() {
        // clear the last workflow id from local storage
        localStorage.removeItem(`lastWorkflowId_${projectId}`);
        setAutoSelectIfOnlyOneWorkflow(false);
        setWorkflow(null);
    }

    async function handleCreateNewVersion() {
        setLoading(true);
        const workflow = await createWorkflow(projectId);
        const publishedWorkflowId = await fetchPublishedWorkflowId(projectId);
        const dataSources = await listDataSources(projectId);
        const testProfile = await getDefaultProfile(projectId);
        // Store the selected workflow ID in local storage
        localStorage.setItem(`lastWorkflowId_${projectId}`, workflow._id);
        setWorkflow(workflow);
        setPublishedWorkflowId(publishedWorkflowId);
        setDataSources(dataSources);
        setDefaultTestProfile(testProfile);
        setLoading(false);
    }

    async function handleCloneVersion(workflowId: string) {
        setLoading(true);
        const workflow = await cloneWorkflow(projectId, workflowId);
        const publishedWorkflowId = await fetchPublishedWorkflowId(projectId);
        const dataSources = await listDataSources(projectId);
        const testProfile = await getDefaultProfile(projectId);
        // Store the selected workflow ID in local storage
        localStorage.setItem(`lastWorkflowId_${projectId}`, workflow._id);
        setWorkflow(workflow);
        setPublishedWorkflowId(publishedWorkflowId);
        setDataSources(dataSources);
        setDefaultTestProfile(testProfile);
        setLoading(false);
    }

    // whenever workflow becomes null, increment selectorKey
    useEffect(() => {
        if (!workflow) {
            setSelectorKey(s => s + 1);
        }
    }, [workflow]);

    // Add this useEffect for initial load
    useEffect(() => {
        // Check localStorage first, fall back to lastWorkflowId prop
        const storedWorkflowId = localStorage.getItem(`lastWorkflowId_${projectId}`);
        if (storedWorkflowId) {
            handleSelect(storedWorkflowId);
        }
    }, [handleSelect, projectId]);

    // if workflow is null, show the selector
    // else show workflow editor
    return <>
        {loading && <div className="flex items-center gap-1">
            <Spinner size="sm" />
            <div>Loading workflow...</div>
        </div>}
        {!loading && workflow == null && <WorkflowSelector
            projectId={projectId}
            key={selectorKey}
            handleSelect={handleSelect}
            handleCreateNewVersion={handleCreateNewVersion}
            autoSelectIfOnlyOneWorkflow={autoSelectIfOnlyOneWorkflow}
        />}
        {!loading && workflow && (dataSources !== null) && (defaultTestProfile !== null) && <WorkflowEditor
            key={workflow._id}
            workflow={workflow}
            dataSources={dataSources}
            initialTestProfile={defaultTestProfile}
            publishedWorkflowId={publishedWorkflowId}
            handleShowSelector={handleShowSelector}
            handleCloneVersion={handleCloneVersion}
        />}
    </>
}

"use client";

import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestSimulation, TestRun } from "@/app/lib/types/testing_types";
import { useEffect, useState } from "react";
import { getRun, getSimulation, listRuns, cancelRun, deleteRun, getSimulationResult, listRunSimulations } from "@/app/actions/testing_actions";
import { Button, Spinner, Selection } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, PlusIcon, DownloadIcon } from "lucide-react";
import { RelativeTime } from "@primer/react"
import { Workflow } from "@/app/lib/types/workflow_types";
import { fetchWorkflow } from "@/app/actions/workflow_actions";
import { StructuredPanel, ActionButton } from "@/app/lib/components/structured-panel"
import { DataTable } from "./components/table"
import { isValidDate } from './utils/date';

function ViewRun({
    projectId,
    runId,
}: {
    projectId: string,
    runId: string,
}) {
    const router = useRouter();
    const [run, setRun] = useState<WithStringId<z.infer<typeof TestRun>> | null>(null);
    const [simulations, setSimulations] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [workflow, setWorkflow] = useState<WithStringId<z.infer<typeof Workflow>> | null>(null);

    useEffect(() => {
        async function fetchData() {
            try {
                const run = await getRun(projectId, runId);
                if (!run) {
                    setError("Run not found");
                    return;
                }
                setRun(run);

                const enrichedSimulations = await listRunSimulations(projectId, run.simulationIds);
                setSimulations(enrichedSimulations);

                // Fetch workflow and simulations in parallel
                const [workflowResult, simulationsResult] = await Promise.all([
                    fetchWorkflow(projectId, run.workflowId),
                    Promise.all(run.simulationIds.map(id => getSimulation(projectId, id)))
                ]);
                setWorkflow(workflowResult);
            } catch (error) {
                setError(`Error fetching run: ${error}`);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [projectId, runId]);

    const columns = [
        {
            key: 'name',
            label: 'SIMULATION',
            render: (simulation: any) => simulation.name
        },
        {
            key: 'scenarioId',
            label: 'SCENARIO',
            render: (simulation: any) => simulation.scenarioName
        },
        {
            key: 'profileId',
            label: 'PROFILE',
            render: (simulation: any) => simulation.profileName
        }
    ];

    const handleDownload = async (simulationId: string) => {
        try {
            const result = await getSimulationResult(projectId, runId, simulationId);
            if (!result) {
                console.error("No result found for simulation");
                return;
            }

            // Get simulation name from simulations array
            const simulation = simulations.find(s => s._id === simulationId);
            if (!simulation) {
                console.error("Simulation not found");
                return;
            }

            // Create a safe filename
            const safeName = `${run?.name}_${simulation.name}`
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores

            // Create the JSON content
            const content = {
                run: run?.name,
                simulation: simulation.name,
                result: result.result,
                details: result.details,
                transcript: result.transcript
            };

            // Create and trigger download
            const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safeName}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error("Failed to download result:", error);
        }
    };

    return <StructuredPanel 
        title="VIEW RUN"
        tooltip="View details of this test run"
        actions={[
            <ActionButton
                key="back"
                icon={<ArrowLeftIcon size={16} />}
                onClick={() => router.push(`/projects/${projectId}/test/runs`)}
            >
                All Runs
            </ActionButton>
        ]}
    >
        {loading && <div className="flex gap-2 items-center">
            <Spinner size="sm" />
            Loading...
        </div>}
        {!loading && !run && <div className="text-gray-600 text-center">Run not found</div>}
        {!loading && run && (
            <div className="flex flex-col gap-6 max-w-4xl">
                {/* Workflow and timing information in a grid */}
                <div className="grid grid-cols-3 gap-4">
                    {workflow && (
                        <div className="bg-gray-50 dark:bg-neutral-800 p-4 rounded-lg">
                            <div className="text-sm font-medium text-gray-600 dark:text-neutral-400 mb-1">Workflow Version</div>
                            <div className="font-medium dark:text-neutral-200">{workflow.name}</div>
                        </div>
                    )}
                    <div className="bg-gray-50 dark:bg-neutral-800 p-4 rounded-lg">
                        <div className="text-sm font-medium text-gray-600 dark:text-neutral-400 mb-1">Completed</div>
                        <div className="text-sm dark:text-neutral-300">
                            {run.completedAt ? <RelativeTime date={new Date(run.completedAt)} /> : 'Not completed'}
                        </div>
                    </div>
                    <div className="bg-gray-50 dark:bg-neutral-800 p-4 rounded-lg">
                        <div className="text-sm font-medium text-gray-600 dark:text-neutral-400 mb-1">Duration</div>
                        <div className="text-sm dark:text-neutral-300">
                            {run.completedAt ? 
                                `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s` : 
                                'In Progress'}
                        </div>
                    </div>
                </div>

                {/* Results statistics */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-neutral-800">
                        <div className="text-sm text-gray-600 dark:text-neutral-400">Total Tests</div>
                        <div className="text-2xl font-semibold dark:text-neutral-200">{run.aggregateResults?.total || 0}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
                        <div className="text-sm text-green-600 dark:text-green-400">Passed</div>
                        <div className="text-2xl font-semibold text-green-700 dark:text-green-400">{run.aggregateResults?.passCount || 0}</div>
                    </div>
                    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
                        <div className="text-sm text-red-600 dark:text-red-400">Failed</div>
                        <div className="text-2xl font-semibold text-red-700 dark:text-red-400">{run.aggregateResults?.failCount || 0}</div>
                    </div>
                </div>

                {/* Simulations List */}
                <div>
                    <h2 className="text-sm font-medium text-gray-600 dark:text-neutral-400 mb-2">Simulations</h2>
                    <DataTable
                        items={simulations}
                        columns={columns}
                        projectId={projectId}
                        onDownload={handleDownload}
                        selectionMode="none"
                    />
                </div>
            </div>
        )}
    </StructuredPanel>
}

function RunsList({ projectId }: { projectId: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = 10;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runs, setRuns] = useState<WithStringId<z.infer<typeof TestRun>>[]>([]);
    const [workflowMap, setWorkflowMap] = useState<Record<string, WithStringId<z.infer<typeof Workflow>>>>({});
    const [total, setTotal] = useState(0);
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<string>());
    const [selectedRuns, setSelectedRuns] = useState<string[]>([]);

    const handleSelectionChange = (selection: Selection) => {
        if (selection === "all" && 
            selectedKeys !== "all" && 
            (selectedKeys as Set<string>).size > 0) {
            setSelectedKeys(new Set());
            setSelectedRuns([]);
        } else {
            setSelectedKeys(selection);
            if (selection === "all") {
                setSelectedRuns(runs.map(run => run._id));
            } else {
                setSelectedRuns(Array.from(selection as Set<string>));
            }
        }
    };

    const handleCancel = async (runId: string) => {
        try {
            await cancelRun(projectId, runId);
            // Update the run status locally after successful cancellation
            setRuns(runs.map(run => {
                if (run._id === runId) {
                    return {
                        ...run,
                        status: 'cancelled'
                    };
                }
                return run;
            }));
        } catch (err) {
            setError(`Failed to cancel run: ${err}`);
        }
    };

    const handleDelete = async (runId: string) => {
        try {
            await deleteRun(projectId, runId);
            // Refresh the runs list after deletion
            const updatedRuns = await listRuns(projectId, page, pageSize);
            setRuns(updatedRuns.runs);
            setTotal(updatedRuns.total);
        } catch (err) {
            setError(`Failed to delete run: ${err}`);
        }
    };

    useEffect(() => {
        let ignore = false;

        async function fetchRuns() {
            setLoading(true);
            setError(null);
            try {
                const result = await listRuns(projectId, page, pageSize);
                if (!ignore) {
                    setRuns(result.runs);
                    setTotal(Math.ceil(result.total / pageSize));
                }
            } catch (error) {
                if (!ignore) {
                    setError(`Unable to fetch runs: ${error}`);
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        }

        if (error == null) {
            fetchRuns();
        }

        return () => {
            ignore = true;
        };
    }, [page, pageSize, error, projectId]);

    useEffect(() => {
        let ignore = false;

        async function resolveWorkflows() {
            const workflowIds = runs.reduce((acc, run) => {
                if (!acc.includes(run.workflowId)) {
                    acc.push(run.workflowId);
                }
                return acc;
            }, [] as string[]);
            
            const workflows = await Promise.all(workflowIds.map((workflowId) => fetchWorkflow(projectId, workflowId)));
            if (ignore) {
                return;
            }
            setWorkflowMap(workflows.filter((workflow) => workflow !== null).reduce((acc, workflow) => {
                acc[workflow._id] = workflow;
                return acc;
            }, {} as Record<string, WithStringId<z.infer<typeof Workflow>>>));
        }

        if (error == null) {
            resolveWorkflows();
        }

        return () => {
            ignore = true;
        };
    }, [runs, error, projectId]);

    const columns = [
        {
            key: 'name',
            label: 'NAME',
            render: (run: any) => run.name
        },
        {
            key: 'status',
            label: 'STATUS',
            render: (run: any) => (
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${getStatusStyles(run.status)}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${getStatusDotStyles(run.status)}`} />
                    {run.status.charAt(0).toUpperCase() + run.status.slice(1)}
                </div>
            )
        },
        {
            key: 'results',
            label: 'RESULTS',
            render: (run: any) => (
                <div className="flex items-center gap-2">
                    <span className="text-green-600 dark:text-green-400">{run.passCount || 0} passed</span>
                    <span className="text-red-600 dark:text-red-400">{run.failCount || 0} failed</span>
                </div>
            )
        },
        {
            key: 'createdAt',
            label: 'STARTED',
            render: (run: any) => isValidDate(run.startedAt) ? 
                <RelativeTime date={new Date(run.startedAt)} /> : 
                'Invalid date'
        }
    ];

    return (
        <StructuredPanel 
            title="TEST RUNS"
            tooltip="View and manage your test runs"
        >
            <div className="flex flex-col gap-6 max-w-4xl">
                {/* Header Section */}
                <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Test Runs</h1>
                        <p className="text-sm text-gray-600 dark:text-neutral-400">
                            View and monitor your workflow test runs
                        </p>
                    </div>
                    <Button
                        size="sm"
                        color="primary"
                        startContent={<PlusIcon size={16} />}
                        onPress={() => router.push(`/projects/${projectId}/test/simulations`)}
                    >
                        New Run
                    </Button>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                        {error}
                        <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                    </div>
                )}

                {/* Runs Table */}
                {loading ? (
                    <div className="flex gap-2 items-center justify-center p-8 text-gray-600 dark:text-neutral-400">
                        <Spinner size="sm" />
                        Loading test runs...
                    </div>
                ) : runs.length === 0 ? (
                    <div className="text-center p-8 bg-gray-50 dark:bg-neutral-900 rounded-lg border border-dashed border-gray-200 dark:border-neutral-800">
                        <p className="text-gray-600 dark:text-neutral-400">No test runs created yet</p>
                    </div>
                ) : (
                    <DataTable
                        items={runs}
                        columns={columns}
                        selectedKeys={selectedKeys}
                        onSelectionChange={handleSelectionChange}
                        onDelete={handleDelete}
                        onView={(id) => router.push(`/projects/${projectId}/test/runs/${id}`)}
                        projectId={projectId}
                    />
                )}
            </div>
        </StructuredPanel>
    );
}

// Helper functions for status styling
function getStatusStyles(status: string): string {
    const styles = {
        pending: "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-neutral-300",
        running: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
        cancelled: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
        failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
        error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    };
    return styles[status as keyof typeof styles] || styles.pending;
}

function getStatusDotStyles(status: string): string {
    const styles = {
        pending: "bg-gray-500 dark:bg-neutral-400",
        running: "bg-blue-500 dark:bg-blue-400",
        completed: "bg-green-500 dark:bg-green-400",
        cancelled: "bg-yellow-500 dark:bg-yellow-400",
        failed: "bg-red-500 dark:bg-red-400",
        error: "bg-red-500 dark:bg-red-400"
    };
    return styles[status as keyof typeof styles] || styles.pending;
}

export function RunsApp({
    projectId,
    slug
}: {
    projectId: string,
    slug: string[]
}) {
    let selection: "list" | "view" = "list";
    let runId: string | null = null;
    if (slug.length > 0) {
        selection = "view";
        runId = slug[0];
    }

    return <>
        {selection === "list" && <RunsList projectId={projectId} />}
        {selection === "view" && runId && <ViewRun projectId={projectId} runId={runId} />}
    </>;
}
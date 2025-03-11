import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestSimulation, TestRun } from "@/app/lib/types/testing_types";
import { useEffect, useState, useRef } from "react";
import { createRun, getRun, getSimulation, listRuns } from "@/app/actions/testing_actions";
import { Button, Input, Pagination, Spinner, Chip } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { RelativeTime } from "@primer/react"
import { SimulationSelector } from "@/app/lib/components/selectors/simulation-selector";
import { WorkflowSelector } from "@/app/lib/components/selectors/workflow-selector";
import { Workflow } from "@/app/lib/types/workflow_types";
import { fetchWorkflow } from "@/app/actions/workflow_actions";

function NewRun({
    projectId,
}: {
    projectId: string,
}) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [selectedSimulations, setSelectedSimulations] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>([]);
    const [isSimulationSelectorOpen, setIsSimulationSelectorOpen] = useState(false);
    const [selectedWorkflow, setSelectedWorkflow] = useState<WithStringId<z.infer<typeof Workflow>> | null>(null);
    const [isWorkflowSelectorOpen, setIsWorkflowSelectorOpen] = useState(false);

    async function handleSubmit(formData: FormData) {
        setError(null);
        const simulationIds = selectedSimulations.map(sim => sim._id);

        if (!selectedWorkflow) {
            setError("Please select a workflow");
            return;
        }

        if (simulationIds.length === 0) {
            setError("Please select at least one simulation");
            return;
        }

        try {
            const run = await createRun(projectId, {
                workflowId: selectedWorkflow._id,
                simulationIds
            });
            router.push(`/projects/${projectId}/test/runs/${run._id}`);
        } catch (error) {
            setError(`Unable to create run: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 pb-2 border-b border-gray-200">New Run</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/runs`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Runs
        </Button>
        {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
            {error}
            <Button
                size="sm"
                color="danger"
                onPress={() => {
                    formRef.current?.requestSubmit();
                }}
            >
                Retry
            </Button>
        </div>}
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Workflow</label>
                <div className="flex items-center gap-2">
                    {selectedWorkflow ? (
                        <div className="text-sm text-blue-600">{selectedWorkflow.name}</div>
                    ) : (
                        <div className="text-sm text-gray-500">No workflow selected</div>
                    )}
                    <Button
                        size="sm"
                        onPress={() => setIsWorkflowSelectorOpen(true)}
                        type="button"
                    >
                        {selectedWorkflow ? "Change" : "Select"} Workflow
                    </Button>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <Button
                    size="sm"
                    onPress={() => setIsSimulationSelectorOpen(true)}
                    type="button"
                    className="self-start"
                >
                    Select Simulations
                </Button>
                {selectedSimulations.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {selectedSimulations.map((sim) => (
                            <Chip
                                key={sim._id}
                                onClose={() => setSelectedSimulations(prev => prev.filter(s => s._id !== sim._id))}
                                variant="flat"
                                className="py-1"
                            >
                                {sim.name}
                            </Chip>
                        ))}
                    </div>
                )}
            </div>
            <FormStatusButton
                props={{
                    className: "self-start",
                    children: "Create Run",
                    size: "sm",
                    type: "submit",
                    isDisabled: !selectedWorkflow || selectedSimulations.length === 0,
                }}
            />
        </form>

        <SimulationSelector
            projectId={projectId}
            isOpen={isSimulationSelectorOpen}
            onOpenChange={setIsSimulationSelectorOpen}
            onSelect={setSelectedSimulations}
            initialSelected={selectedSimulations}
        />

        <WorkflowSelector
            projectId={projectId}
            isOpen={isWorkflowSelectorOpen}
            onOpenChange={setIsWorkflowSelectorOpen}
            onSelect={setSelectedWorkflow}
        />
    </div>;
}

function ViewRun({
    projectId,
    runId,
}: {
    projectId: string,
    runId: string,
}) {
    const [run, setRun] = useState<WithStringId<z.infer<typeof TestRun>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [workflow, setWorkflow] = useState<WithStringId<z.infer<typeof Workflow>> | null>(null);
    const [simulations, setSimulations] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>([]);

    useEffect(() => {
        async function fetchRun() {
            const run = await getRun(projectId, runId);
            setRun(run);
            if (run) {
                // Fetch workflow and simulations in parallel
                const [workflowResult, simulationsResult] = await Promise.all([
                    fetchWorkflow(projectId, run.workflowId),
                    Promise.all(run.simulationIds.map(id => getSimulation(projectId, id)))
                ]);
                setWorkflow(workflowResult);
                setSimulations(simulationsResult.filter(s => s !== null));
            }
            setLoading(false);
        }
        fetchRun();
    }, [runId, projectId]);

    return <div className="h-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
            <Button
                size="sm"
                className="self-start"
                as={Link}
                href={`/projects/${projectId}/test/runs`}
                startContent={<ArrowLeftIcon className="w-4 h-4" />}
            >
                All Runs
            </Button>
        </div>

        {loading && <div className="flex gap-2 items-center">
            <Spinner size="sm" />
            Loading...
        </div>}
        {!loading && !run && <div className="text-gray-600 text-center">Run not found</div>}
        {!loading && run && (
            <>
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
                <div className="mt-4">
                    <h2 className="text-sm font-medium text-gray-600 dark:text-neutral-400 mb-2">Simulations</h2>
                    <div className="space-y-2">
                        {simulations.map(sim => (
                            <div key={sim._id} className="border dark:border-neutral-800 rounded-lg p-3">
                                <Link
                                    href={`/projects/${projectId}/test/simulations/${sim._id}`}
                                    className="text-blue-600 hover:underline"
                                >
                                    {sim.name}
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </>
        )}
    </div>;
}

function RunList({
    projectId,
}: {
    projectId: string,
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = 10;
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [runs, setRuns] = useState<WithStringId<z.infer<typeof TestRun>>[]>([]);
    const [workflowMap, setWorkflowMap] = useState<Record<string, WithStringId<z.infer<typeof Workflow>>>>({});
    const [total, setTotal] = useState(0);

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

    return <div className="h-full flex flex-col gap-4">
        <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-gray-800 dark:text-neutral-200">Test Runs</h1>
            <Button
                size="sm"
                onPress={() => router.push(`/projects/${projectId}/test/runs/new`)}
                startContent={<PlusIcon className="w-4 h-4" />}
            >
                New Run
            </Button>
        </div>

        {loading && <div className="flex gap-2 items-center">
            <Spinner size="sm" />
            Loading...
        </div>}
        {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
        </div>}
        {!loading && !error && <>
            {runs.length === 0 && <div className="text-gray-600 dark:text-neutral-400 text-center">No test runs found</div>}
            {runs.length > 0 && <div className="space-y-4">
                {runs.map((run) => (
                    <div key={run._id} className="border dark:border-neutral-800 rounded-lg shadow-sm">
                        <div className="p-4 flex items-center justify-between hover:bg-neutral-100 dark:hover:bg-neutral-800">
                            <div className="flex items-center space-x-4">
                                <Link
                                    href={`/projects/${projectId}/test/runs/${run._id}`}
                                    className="text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                    {run.name}
                                </Link>
                                {workflowMap[run.workflowId] && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-neutral-400">
                                        <WorkflowIcon className="w-4 h-4 shrink-0" />
                                        {workflowMap[run.workflowId].name}
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-4">
                                <span className={getStatusClass(run.status)}>
                                    {run.status}
                                </span>
                                <div className="text-sm text-gray-600 dark:text-neutral-400">
                                    <RelativeTime date={new Date(run.startedAt)} />
                                </div>
                            </div>
                        </div>
                        {run.aggregateResults && (
                            <div className="border-t dark:border-neutral-800 px-4 py-2 bg-gray-50 dark:bg-neutral-900/50">
                                <div className="grid grid-cols-3 gap-4 text-sm">
                                    <div className="text-gray-600 dark:text-neutral-400">
                                        Total: {run.aggregateResults.total}
                                    </div>
                                    <div className="text-green-600 dark:text-green-400">
                                        Passed: {run.aggregateResults.passCount}
                                    </div>
                                    <div className="text-red-600 dark:text-red-400">
                                        Failed: {run.aggregateResults.failCount}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>}
            {total > 1 && <Pagination
                total={total}
                page={page}
                onChange={(page) => {
                    router.push(`/projects/${projectId}/test/runs?page=${page}`);
                }}
                className="self-center"
            />}
        </>}
    </div>;
}

// Helper function for status styling
function getStatusClass(status: string) {
    const baseClass = "px-2 py-1 rounded text-xs uppercase font-medium";
    switch (status) {
        case 'completed':
            return `${baseClass} bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400`;
        case 'failed':
        case 'error':
            return `${baseClass} bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-400`;
        case 'cancelled':
            return `${baseClass} bg-gray-100 dark:bg-neutral-800 text-gray-800 dark:text-neutral-400`;
        case 'running':
        case 'pending':
        default:
            return `${baseClass} bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400`;
    }
}

export function RunsApp({
    projectId,
    slug
}: {
    projectId: string,
    slug: string[]
}) {
    let selection: "list" | "view" | "new" = "list";
    let runId: string | null = null;
    if (slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else {
            selection = "view";
            runId = slug[0];
        }
    }

    return <>
        {selection === "list" && <RunList projectId={projectId} />}
        {selection === "new" && <NewRun projectId={projectId} />}
        {selection === "view" && runId && <ViewRun projectId={projectId} runId={runId} />}
    </>;
}
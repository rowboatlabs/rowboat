"use client";

import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestProfile, TestScenario, TestSimulation, TestRun } from "@/app/lib/types/testing_types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { useEffect, useState, useRef } from "react";
import { createSimulation, getSimulation, listSimulations, updateSimulation, deleteSimulation, getScenario, getProfile, createRun } from "@/app/actions/testing_actions";
import { Button, Spinner, Tooltip, Selection } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { PlusIcon, ArrowLeftIcon, AlertTriangleIcon } from "lucide-react";
import { RelativeTime } from "@primer/react"
import { ScenarioSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/scenario-selector";
import { ProfileSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/profile-selector";
import { StructuredPanel, ActionButton } from "@/app/lib/components/structured-panel";
import { WorkflowSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/workflow-selector";
import { DataTable } from "./components/table"
import { isValidDate } from './utils/date';
import { SimulationForm } from "./components/simulation-form";

function EditSimulation({
    projectId,
    simulationId,
}: {
    projectId: string,
    simulationId: string,
}) {
    const router = useRouter();
    const [simulation, setSimulation] = useState<WithStringId<z.infer<typeof TestSimulation>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scenario, setScenario] = useState<WithStringId<z.infer<typeof TestScenario>> | null>(null);
    const [profile, setProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);
    const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        async function fetchSimulation() {
            setError(null);
            try {
                const simulation = await getSimulation(projectId, simulationId);
                setSimulation(simulation);
                if (simulation) {
                    const [scenarioResult, profileResult] = await Promise.all([
                        getScenario(projectId, simulation.scenarioId),
                        simulation.profileId ? getProfile(projectId, simulation.profileId) : Promise.resolve(null),
                    ]);
                    setScenario(scenarioResult);
                    setProfile(profileResult);
                }
            } catch (error) {
                setError(`Unable to fetch simulation: ${error}`);
            } finally {
                setLoading(false);
            }
        }
        fetchSimulation();
    }, [simulationId, projectId]);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const description = formData.get("description") as string;
            const passCriteria = formData.get("passCriteria") as string;

            if (!scenario) {
                throw new Error("Please select a scenario");
            }

            await updateSimulation(projectId, simulationId, {
                name,
                description,
                scenarioId: scenario._id,
                profileId: profile?._id || null,
                passCriteria
            });
            router.push(`/projects/${projectId}/test/simulations`);
        } catch (error) {
            setError(`Unable to update simulation: ${error}`);
        }
    }

    return <StructuredPanel 
        title="EDIT SIMULATION"
        tooltip="Edit an existing test simulation"
    >
        <div className="flex flex-col gap-6 max-w-2xl">
            {loading && (
                <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
                    <Spinner size="sm" />
                    Loading simulation...
                </div>
            )}
            
            {error && (
                <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                    {error}
                    <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                </div>
            )}

            {!loading && simulation && (
                <>
                    <div>
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Simulation</h1>
                        <p className="text-gray-600 dark:text-neutral-400">
                            Define a test simulation by selecting a scenario and optionally a profile
                        </p>
                    </div>

                    <SimulationForm
                        formRef={formRef}
                        handleSubmit={handleSubmit}
                        scenario={scenario}
                        setScenario={setScenario}
                        profile={profile}
                        setProfile={setProfile}
                        isScenarioModalOpen={isScenarioModalOpen}
                        setIsScenarioModalOpen={setIsScenarioModalOpen}
                        isProfileModalOpen={isProfileModalOpen}
                        setIsProfileModalOpen={setIsProfileModalOpen}
                        projectId={projectId}
                        submitButtonText="Update Simulation"
                        defaultValues={{
                            name: simulation.name ?? '',
                            description: simulation.description ?? '',
                            passCriteria: simulation.passCriteria ?? ''
                        }}
                        onCancel={() => router.push(`/projects/${projectId}/test/simulations`)}
                    />

                    <ScenarioSelector
                        projectId={projectId}
                        isOpen={isScenarioModalOpen}
                        onOpenChange={setIsScenarioModalOpen}
                        onSelect={setScenario}
                    />
                    <ProfileSelector
                        projectId={projectId}
                        isOpen={isProfileModalOpen}
                        onOpenChange={setIsProfileModalOpen}
                        onSelect={setProfile}
                    />
                </>
            )}
        </div>
    </StructuredPanel>;
}

function NewSimulation({
    projectId,
}: {
    projectId: string,
}) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [scenario, setScenario] = useState<WithStringId<z.infer<typeof TestScenario>> | null>(null);
    const [profile, setProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const description = formData.get("description") as string;
            const passCriteria = formData.get("passCriteria") as string;

            if (!name || !passCriteria) {
                throw new Error("Name and Pass Criteria are required");
            }

            if (!scenario) {
                throw new Error("Please select a scenario");
            }

            const result = await createSimulation(projectId, {
                name,
                description,
                scenarioId: scenario._id,
                profileId: profile?._id || null,
                passCriteria,
            });
            router.push(`/projects/${projectId}/test/simulations/${result._id}`);
        } catch (error) {
            setError(`Unable to create simulation: ${error}`);
        }
    }

    return <StructuredPanel 
        title="NEW SIMULATION"
        tooltip="Create a new test simulation"
        actions={[
            <ActionButton
                key="back"
                icon={<ArrowLeftIcon size={16} />}
                onClick={() => router.push(`/projects/${projectId}/test/simulations`)}
            >
                All Simulations
            </ActionButton>
        ]}
    >
        <div className="h-full flex flex-col gap-6 max-w-2xl">
            <div className="flex flex-col gap-1">
                <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Create New Simulation</h1>
                <p className="text-sm text-gray-600 dark:text-neutral-400">
                    Define a new test simulation by selecting a scenario and optionally a profile
                </p>
            </div>

            {error && <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                {error}
                <Button size="sm" color="danger" onPress={() => formRef.current?.requestSubmit()}>Retry</Button>
            </div>}

            <SimulationForm
                formRef={formRef}
                handleSubmit={handleSubmit}
                scenario={scenario}
                setScenario={setScenario}
                profile={profile}
                setProfile={setProfile}
                isScenarioModalOpen={isScenarioModalOpen}
                setIsScenarioModalOpen={setIsScenarioModalOpen}
                isProfileModalOpen={isProfileModalOpen}
                setIsProfileModalOpen={setIsProfileModalOpen}
                projectId={projectId}
                submitButtonText="Create Simulation"
                onCancel={() => router.push(`/projects/${projectId}/test/simulations`)}
            />
        </div>
    </StructuredPanel>;
}

function SimulationList({ projectId }: { projectId: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = 10;
    const [simulations, setSimulations] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>([]);
    const [selectedSimulations, setSelectedSimulations] = useState<string[]>([]);
    const [selectedWorkflow, setSelectedWorkflow] = useState<WithStringId<z.infer<typeof Workflow>> | null>(null);
    const [isWorkflowSelectorOpen, setIsWorkflowSelectorOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [simulationDetails, setSimulationDetails] = useState<Record<string, {
        scenario?: WithStringId<z.infer<typeof TestScenario>>,
        profile?: WithStringId<z.infer<typeof TestProfile>>
    }>>({});
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<string>());

    useEffect(() => {
        let ignore = false;

        async function fetchSimulations() {
            setLoading(true);
            setError(null);
            try {
                const result = await listSimulations(projectId, page, pageSize);
                if (!ignore) {
                    setSimulations(result.simulations);
                    setTotal(result.total);
                    
                    // Fetch scenario and profile details for each simulation
                    const details: Record<string, any> = {};
                    await Promise.all(result.simulations.map(async (simulation) => {
                        const [scenarioResult, profileResult] = await Promise.all([
                            getScenario(projectId, simulation.scenarioId),
                            simulation.profileId ? getProfile(projectId, simulation.profileId) : Promise.resolve(null),
                        ]);
                        if (!ignore) {
                            details[simulation._id] = {
                                scenario: scenarioResult,
                                profile: profileResult
                            };
                        }
                    }));
                    if (!ignore) {
                        setSimulationDetails(details);
                    }
                }
            } catch (error) {
                if (!ignore) {
                    setError(`Unable to fetch simulations: ${error}`);
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        }

        fetchSimulations();

        return () => {
            ignore = true;
        };
    }, [projectId, page, pageSize]);

    const handleSelectionChange = (selection: Selection) => {
        setSelectedKeys(selection);
        if (selection === "all") {
            setSelectedSimulations(simulations.map(sim => sim._id));
        } else {
            setSelectedSimulations(Array.from(selection as Set<string>));
        }
    };

    async function handleCreateRun() {
        if (!selectedWorkflow || selectedSimulations.length === 0) {
            return; // Just return without setting error
        }

        try {
            const run = await createRun(projectId, {
                workflowId: selectedWorkflow._id,
                simulationIds: selectedSimulations
            });

            setSelectedSimulations([]);
            setSelectedWorkflow(null);
            
            router.push(`/projects/${projectId}/test/runs/${run._id}`);
        } catch (err) {
            setError(`Failed to create test run: ${err}`);
        }
    }

    const handleDelete = async (simulationId: string) => {
        try {
            await deleteSimulation(projectId, simulationId);
            // Refresh the simulations list after deletion
            const result = await listSimulations(projectId, page, pageSize);
            setSimulations(result.simulations);
            setTotal(result.total);
        } catch (err) {
            setError(`Failed to delete simulation: ${err}`);
        }
    };

    const handleLaunchClick = () => {
        if (!selectedWorkflow || selectedSimulations.length === 0) {
            alert("Please select a workflow version and at least one simulation.");
        } else {
            handleCreateRun();
        }
    };

    const columns = [
        {
            key: 'name',
            label: 'NAME',
            render: (simulation: any) => (
                <div className="flex items-center gap-2">
                    <span>{simulation.name}</span>
                    {(!simulationDetails[simulation._id]?.scenario || 
                     (simulation.profileId && !simulationDetails[simulation._id]?.profile)) && (
                        <Tooltip content="Associated scenario or profile has been deleted">
                            <AlertTriangleIcon 
                                size={16} 
                                className="text-amber-500 dark:text-amber-400"
                            />
                        </Tooltip>
                    )}
                </div>
            )
        },
        {
            key: 'scenarioId',
            label: 'SCENARIO',
            render: (simulation: any) => {
                const details = simulationDetails[simulation._id];
                if (!details?.scenario) {
                    return (
                        <div className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
                            <Tooltip content="This scenario has been deleted">
                                <AlertTriangleIcon size={14} />
                            </Tooltip>
                            <span>Deleted</span>
                        </div>
                    );
                }
                return details.scenario.name;
            }
        },
        {
            key: 'profileId',
            label: 'PROFILE',
            render: (simulation: any) => {
                const details = simulationDetails[simulation._id];
                if (simulation.profileId && !details?.profile) {
                    return (
                        <div className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
                            <Tooltip content="This profile has been deleted">
                                <AlertTriangleIcon size={14} />
                            </Tooltip>
                            <span>Deleted</span>
                        </div>
                    );
                }
                return details?.profile?.name || 'None';
            }
        },
        {
            key: 'createdAt',
            label: 'CREATED',
            render: (simulation: any) => isValidDate(simulation.createdAt) ? 
                <RelativeTime date={new Date(simulation.createdAt)} /> : 
                'Invalid date'
        }
    ];

    return (
        <StructuredPanel 
            title="SIMULATIONS"
            tooltip="View and manage your test simulations"
        >
            <div className="flex flex-col gap-6 max-w-4xl">
                {/* Combined Guidance and Run Creation Section */}
                <div className="flex flex-col gap-4 p-6 bg-white dark:bg-neutral-950 rounded-lg border border-gray-200 dark:border-neutral-800">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Create a Test Run
                    </h2>
                    
                    <div className="flex flex-col gap-4">
                        {/* Step 1: Create New Simulation */}
                        <div className="flex items-start gap-4">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                                1
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                    Create a New Simulation (Optional)
                                </h3>
                                <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">
                                    Define a new test simulation if needed
                                </p>
                                <div className="mt-3">
                                    <Button
                                        size="sm"
                                        color="primary"
                                        startContent={<PlusIcon size={16} />}
                                        onPress={() => router.push(`/projects/${projectId}/test/simulations/new`)}
                                    >
                                        New Simulation
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Step 2: Select Workflow Version */}
                        <div className="flex items-start gap-4">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                                2
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                        Select workflow version
                                    </h3>
                                    <Button
                                        size="sm"
                                        variant={selectedWorkflow ? "solid" : "flat"}
                                        onPress={() => setIsWorkflowSelectorOpen(true)}
                                    >
                                        {selectedWorkflow?.name || 'Select Version'}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Step 3: Select Simulations */}
                        <div className="flex items-start gap-4">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                                3
                            </div>
                            <div className="flex-1">
                                <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                    Select Simulations for the Test Run
                                </h3>
                                <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">
                                    Choose one or more simulations from the table below
                                </p>
                            </div>
                        </div>

                        {/* Step 4: Create Test Run */}
                        <div className="flex items-start gap-4">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                                4
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                                        Create test run
                                    </h3>
                                    <Tooltip
                                        content={
                                            !selectedWorkflow && selectedSimulations.length === 0 
                                                ? "Please select a workflow version and at least one simulation"
                                                : !selectedWorkflow 
                                                    ? "Please select a workflow version"
                                                    : selectedSimulations.length === 0 
                                                        ? "Please select at least one simulation"
                                                        : ""
                                        }
                                        isDisabled={Boolean(selectedWorkflow && selectedSimulations.length > 0)}
                                    >
                                        <Button
                                            size="sm"
                                            color="primary"
                                            onPress={handleCreateRun}
                                            className={(!selectedWorkflow || selectedSimulations.length === 0) ? "opacity-50 cursor-not-allowed" : ""}
                                        >
                                            Launch Test Run {selectedSimulations.length > 0 ? `(${selectedSimulations.length})` : ''}
                                        </Button>
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Error Display - Only for API/system errors */}
                {error && error.startsWith('Failed to') && (
                    <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                        {error}
                        <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                    </div>
                )}

                {/* Simulations Table */}
                {loading ? (
                    <div className="flex gap-2 items-center justify-center p-8 text-gray-600 dark:text-neutral-400">
                        <Spinner size="sm" />
                        Loading simulations...
                    </div>
                ) : simulations.length === 0 ? (
                    <div className="text-center p-8 bg-gray-50 dark:bg-neutral-900 rounded-lg border border-dashed border-gray-200 dark:border-neutral-800">
                        <p className="text-gray-600 dark:text-neutral-400">No simulations created yet</p>
                    </div>
                ) : (
                    <DataTable
                        items={simulations}
                        columns={columns}
                        selectedKeys={selectedKeys}
                        onSelectionChange={handleSelectionChange}
                        onDelete={handleDelete}
                        onEdit={(id) => router.push(`/projects/${projectId}/test/simulations/${id}/edit`)}
                        projectId={projectId}
                    />
                )}

                <WorkflowSelector
                    projectId={projectId}
                    isOpen={isWorkflowSelectorOpen}
                    onOpenChange={setIsWorkflowSelectorOpen}
                    onSelect={setSelectedWorkflow}
                />
            </div>
        </StructuredPanel>
    );
}

export function SimulationsApp({ projectId, slug }: { projectId: string; slug?: string[] }) {
    let selection: "list" | "new" | "edit" = "list";
    let simulationId: string | undefined;

    if (slug && slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else if (slug[1] === "edit") {
            selection = "edit";
            simulationId = slug[0];
        } else {
            selection = "list";
            simulationId = slug[0];
        }
    }

    return (
        <div className="h-full">
            {selection === "list" && <SimulationList projectId={projectId} />}
            {selection === "new" && <NewSimulation projectId={projectId} />}
            {selection === "edit" && simulationId && (
                <EditSimulation projectId={projectId} simulationId={simulationId} />
            )}
        </div>
    );
} 
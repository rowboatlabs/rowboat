"use client";

import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestScenario } from "@/app/lib/types/testing_types";
import { useEffect, useState, useRef } from "react";
import { createScenario, getScenario, listScenarios, updateScenario, deleteScenario } from "@/app/actions/testing_actions";
import { Button, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Selection } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, PlusIcon, } from "lucide-react";
import { RelativeTime } from "@primer/react"
import { StructuredPanel, ActionButton } from "@/app/lib/components/structured-panel";
import { DataTable } from "./components/table";
import { isValidDate } from './utils/date';
import { ItemView } from "./components/item-view"
import { ScenarioForm } from "./components/scenario-form";

function EditScenario({
    projectId,
    scenarioId,
}: {
    projectId: string,
    scenarioId: string,
}) {
    const router = useRouter();
    const [scenario, setScenario] = useState<WithStringId<z.infer<typeof TestScenario>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        async function fetchScenario() {
            setError(null);
            try {
                const scenario = await getScenario(projectId, scenarioId);
                setScenario(scenario);
            } catch (error) {
                setError(`Unable to fetch scenario: ${error}`);
            } finally {
                setLoading(false);
            }
        }
        fetchScenario();
    }, [scenarioId, projectId]);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const description = formData.get("description") as string;
            await updateScenario(projectId, scenarioId, { name, description });
            router.push(`/projects/${projectId}/test/scenarios`);
        } catch (error) {
            setError(`Unable to update scenario: ${error}`);
        }
    }

    return <StructuredPanel 
        title="EDIT SCENARIO"
        tooltip="Edit an existing test scenario"
    >
        <div className="flex flex-col gap-6 max-w-2xl">
            {loading && (
                <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
                    <Spinner size="sm" />
                    Loading scenario...
                </div>
            )}

            {error && (
                <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                    {error}
                    <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                </div>
            )}

            {!loading && scenario && (
                <ScenarioForm
                    formRef={formRef}
                    handleSubmit={handleSubmit}
                    onCancel={() => router.push(`/projects/${projectId}/test/scenarios`)}
                    submitButtonText="Update Scenario"
                    defaultValues={{
                        name: scenario.name,
                        description: scenario.description
                    }}
                />
            )}
        </div>
    </StructuredPanel>;
}

function ViewScenario({
    projectId,
    scenarioId,
}: {
    projectId: string,
    scenarioId: string,
}) {
    const router = useRouter();
    const [scenario, setScenario] = useState<WithStringId<z.infer<typeof TestScenario>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchScenario() {
            const scenario = await getScenario(projectId, scenarioId);
            setScenario(scenario);
            setLoading(false);
        }
        fetchScenario();
    }, [scenarioId, projectId]);

    async function handleDelete() {
        try {
            await deleteScenario(projectId, scenarioId);
            router.push(`/projects/${projectId}/test/scenarios`);
        } catch (error) {
            setDeleteError(`Failed to delete scenario: ${error}`);
        }
    }

    return (
        <StructuredPanel 
            title="VIEW SCENARIO"
            tooltip="View scenario details"
            actions={[
                <ActionButton
                    key="back"
                    icon={<ArrowLeftIcon size={16} />}
                    onClick={() => router.push(`/projects/${projectId}/test/scenarios`)}
                >
                    All Scenarios
                </ActionButton>
            ]}
        >
            <ItemView
                items={[
                    { label: "Name", value: scenario?.name },
                    { label: "Description", value: scenario?.description },
                    {
                        label: "Created",
                        value: scenario?.createdAt && isValidDate(scenario.createdAt)
                            ? <RelativeTime date={new Date(scenario.createdAt)} />
                            : 'Invalid date'
                    },
                    {
                        label: "Last Updated",
                        value: scenario?.lastUpdatedAt && isValidDate(scenario.lastUpdatedAt)
                            ? <RelativeTime date={new Date(scenario.lastUpdatedAt)} />
                            : 'Invalid date'
                    }
                ]}
                actions={
                    <>
                        <Button size="sm" variant="flat" onPress={() => router.push(`/projects/${projectId}/test/scenarios/${scenarioId}/edit`)}>Edit</Button>
                        <Button size="sm" color="danger" variant="flat" onPress={() => setIsDeleteModalOpen(true)}>Delete</Button>
                    </>
                }
            />
            <Modal
                isOpen={isDeleteModalOpen}
                onOpenChange={setIsDeleteModalOpen}
                size="sm"
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>Confirm Deletion</ModalHeader>
                            <ModalBody>
                                Are you sure you want to delete this scenario?
                            </ModalBody>
                            <ModalFooter>
                                <Button size="sm" variant="flat" onPress={onClose}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    color="danger"
                                    onPress={() => {
                                        handleDelete();
                                        onClose();
                                    }}
                                >
                                    Delete
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
            <Modal
                isOpen={deleteError !== null}
                onOpenChange={() => setDeleteError(null)}
                size="sm"
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>Error</ModalHeader>
                            <ModalBody>
                                {deleteError}
                            </ModalBody>
                            <ModalFooter>
                                <Button size="sm" onPress={onClose}>
                                    Close
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </StructuredPanel>
    );
}

function NewScenario({
    projectId,
}: {
    projectId: string,
}) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const description = formData.get("description") as string;
            await createScenario(projectId, { name, description });
            router.push(`/projects/${projectId}/test/scenarios`);
        } catch (error) {
            setError(`Unable to create scenario: ${error}`);
        }
    }

    return <StructuredPanel 
        title="NEW SCENARIO"
        tooltip="Create a new test scenario"
    >
        <div className="flex flex-col gap-6 max-w-2xl">
            {error && (
                <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                    {error}
                    <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                </div>
            )}
            
            <ScenarioForm
                formRef={formRef}
                handleSubmit={handleSubmit}
                onCancel={() => router.push(`/projects/${projectId}/test/scenarios`)}
                submitButtonText="Create Scenario"
            />
        </div>
    </StructuredPanel>;
}

function ScenarioList({
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
    const [scenarios, setScenarios] = useState<WithStringId<z.infer<typeof TestScenario>>[]>([]);
    const [total, setTotal] = useState(0);
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<string>());
    const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);

    useEffect(() => {
        let ignore = false;

        async function fetchScenarios() {
            setLoading(true);
            setError(null);
            try {
                const scenarios = await listScenarios(projectId, page, pageSize);
                if (!ignore) {
                    setScenarios(scenarios.scenarios);
                    setTotal(Math.ceil(scenarios.total / pageSize));
                }
            } catch (error) {
                if (!ignore) {
                    setError(`Unable to fetch scenarios: ${error}`);
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        }

        if (error == null) {
            fetchScenarios();
        }

        return () => {
            ignore = true;
        };
    }, [page, pageSize, error, projectId]);

    const handleSelectionChange = (selection: Selection) => {
        if (selection === "all" && 
            selectedKeys !== "all" && 
            (selectedKeys as Set<string>).size > 0) {
            setSelectedKeys(new Set());
            setSelectedScenarios([]);
        } else {
            setSelectedKeys(selection);
            if (selection === "all") {
                setSelectedScenarios(scenarios.map(scenario => scenario._id));
            } else {
                setSelectedScenarios(Array.from(selection as Set<string>));
            }
        }
    };

    const handleDelete = async (scenarioId: string) => {
        try {
            await deleteScenario(projectId, scenarioId);
            // Refresh the scenarios list after deletion
            const result = await listScenarios(projectId, page, pageSize);
            setScenarios(result.scenarios);
            setTotal(result.total);
        } catch (err) {
            setError(`Failed to delete scenario: ${err}`);
        }
    };

    const columns = [
        {
            key: 'name',
            label: 'NAME',
            render: (scenario: any) => scenario.name
        },
        {
            key: 'description',
            label: 'DESCRIPTION'
        },
        {
            key: 'createdAt',
            label: 'CREATED',
            render: (scenario: any) => isValidDate(scenario.createdAt) ? 
                <RelativeTime date={new Date(scenario.createdAt)} /> : 
                'Invalid date'
        }
    ];

    return <StructuredPanel 
        title="SCENARIOS"
        tooltip="View and manage your test scenarios"
    >
        <div className="flex flex-col gap-6 max-w-4xl">
            {/* Header Section */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Scenarios</h1>
                    <p className="text-sm text-gray-600 dark:text-neutral-400">
                        Create and manage test scenarios for your simulations
                    </p>
                </div>
                <Button
                    size="sm"
                    color="primary"
                    startContent={<PlusIcon size={16} />}
                    onPress={() => router.push(`/projects/${projectId}/test/scenarios/new`)}
                >
                    New Scenario
                </Button>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                    {error}
                    <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                </div>
            )}

            {/* Scenarios Table */}
            {loading ? (
                <div className="flex gap-2 items-center justify-center p-8 text-gray-600 dark:text-neutral-400">
                    <Spinner size="sm" />
                    Loading scenarios...
                </div>
            ) : scenarios.length === 0 ? (
                <div className="text-center p-8 bg-gray-50 dark:bg-neutral-900 rounded-lg border border-dashed border-gray-200 dark:border-neutral-800">
                    <p className="text-gray-600 dark:text-neutral-400">No scenarios created yet</p>
                </div>
            ) : (
                <DataTable
                    items={scenarios}
                    columns={columns}
                    selectedKeys={selectedKeys}
                    onSelectionChange={setSelectedKeys}
                    onDelete={handleDelete}
                    onEdit={(id) => router.push(`/projects/${projectId}/test/scenarios/${id}/edit`)}
                    projectId={projectId}
                />
            )}
        </div>
    </StructuredPanel>;
}

export function ScenariosApp({ projectId, slug }: { projectId: string; slug?: string[] }) {
    let selection: "list" | "new" | "edit" = "list";
    let scenarioId: string | undefined;

    if (slug && slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else if (slug[1] === "edit") {
            selection = "edit";
            scenarioId = slug[0];
        } else {
            selection = "list";
            scenarioId = slug[0];
        }
    }

    return (
        <div className="h-full">
            {selection === "list" && <ScenarioList projectId={projectId} />}
            {selection === "new" && <NewScenario projectId={projectId} />}
            {selection === "edit" && scenarioId && (
                <EditScenario projectId={projectId} scenarioId={scenarioId} />
            )}
        </div>
    );
}
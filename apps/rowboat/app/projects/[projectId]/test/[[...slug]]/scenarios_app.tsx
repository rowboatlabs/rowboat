import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestScenario } from "@/app/lib/types/testing_types";
import { useEffect, useState, useRef } from "react";
import { createScenario, getScenario, listScenarios, updateScenario, deleteScenario } from "@/app/actions/testing_actions";
import { Button, Input, Pagination, Spinner, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { RelativeTime } from "@primer/react"

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
            router.push(`/projects/${projectId}/test/scenarios/${scenarioId}`);
        } catch (error) {
            setError(`Unable to update scenario: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">Edit Scenario</h1>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {error && <div className="bg-red-100 dark:bg-red-900/20 p-2 rounded-md text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onPress={() => formRef.current?.requestSubmit()}>Retry</Button>
        </div>}
        {!loading && scenario && (
            <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
                <Input
                    type="text"
                    name="name"
                    label="Name"
                    placeholder="Enter a name for the scenario"
                    defaultValue={scenario.name}
                    required
                />
                <Textarea
                    name="description"
                    label="Description"
                    placeholder="Enter a description for the scenario"
                    defaultValue={scenario.description}
                    required
                />
                <div className="flex gap-2 items-center">
                    <FormStatusButton
                        props={{
                            className: "self-start",
                            children: "Update",
                            size: "sm",
                            type: "submit",
                        }}
                    />
                    <Button
                        size="sm"
                        variant="flat"
                        as={Link}
                        href={`/projects/${projectId}/test/scenarios/${scenarioId}`}
                    >
                        Cancel
                    </Button>
                </div>
            </form>
        )}
    </div>;
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

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">View Scenario</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/scenarios`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Scenarios
        </Button>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {!loading && !scenario && <div className="text-gray-600 dark:text-neutral-400 text-center">Scenario not found</div>}
        {!loading && scenario && (
            <>
                <div className="flex flex-col gap-1 text-sm">
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Name</div>
                        <div className="flex-[2] dark:text-neutral-200">{scenario.name}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Description</div>
                        <div className="flex-[2] dark:text-neutral-200">{scenario.description}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Created</div>
                        <div className="flex-[2] dark:text-neutral-300"><RelativeTime date={new Date(scenario.createdAt)} /></div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Last Updated</div>
                        <div className="flex-[2] dark:text-neutral-300"><RelativeTime date={new Date(scenario.lastUpdatedAt)} /></div>
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <Button
                        size="sm"
                        as={Link}
                        href={`/projects/${projectId}/test/scenarios/${scenarioId}/edit`}
                    >
                        Edit
                    </Button>
                    <Button
                        size="sm"
                        color="danger"
                        variant="flat"
                        onPress={() => setIsDeleteModalOpen(true)}
                    >
                        Delete
                    </Button>
                </div>

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
                                    <Button
                                        size="sm"
                                        color="primary"
                                        onPress={onClose}
                                    >
                                        Close
                                    </Button>
                                </ModalFooter>
                            </>
                        )}
                    </ModalContent>
                </Modal>
            </>
        )}
    </div>;
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
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        try {
            const scenario = await createScenario(projectId, { name, description });
            router.push(`/projects/${projectId}/test/scenarios/${scenario._id}`);
        } catch (error) {
            setError(`Unable to create scenario: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 pb-2 border-b border-gray-200">New Scenario</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/scenarios`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Scenarios
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
            <Input
                type="text"
                name="name"
                label="Name"
                placeholder="Enter a name for the scenario"
                required
            />
            <Textarea
                name="description"
                label="Description"
                placeholder="Enter a description for the scenario"
                required
            />
            <FormStatusButton
                props={{
                    className: "self-start",
                    children: "Create",
                    size: "sm",
                    type: "submit",
                }}
            />
        </form>
    </div>;
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

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">Scenarios</h1>
        <Button
            size="sm"
            onPress={() => router.push(`/projects/${projectId}/test/scenarios/new`)}
            className="self-end"
            startContent={<PlusIcon className="w-4 h-4" />}
        >
            New Scenario
        </Button>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {error && <div className="bg-red-100 dark:bg-red-900/20 p-2 rounded-md text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
        </div>}
        {!loading && !error && <>
            {scenarios.length === 0 && <div className="text-gray-600 dark:text-neutral-400 text-center">No scenarios found</div>}
            {scenarios.length > 0 && <div className="flex flex-col w-full">
                {/* Header */}
                <div className="grid grid-cols-7 py-2 bg-gray-100 dark:bg-neutral-800 font-semibold text-sm">
                    <div className="col-span-2 px-4 dark:text-neutral-300">Name</div>
                    <div className="col-span-3 px-4 dark:text-neutral-300">Description</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Created</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Updated</div>
                </div>

                {/* Rows */}
                {scenarios.map((scenario) => (
                    <div key={scenario._id} className="grid grid-cols-7 py-2 border-b border-gray-200 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800 text-sm">
                        <div className="col-span-2 px-4 truncate">
                            <Link
                                href={`/projects/${projectId}/test/scenarios/${scenario._id}`}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                {scenario.name}
                            </Link>
                        </div>
                        <div className="col-span-3 px-4 truncate dark:text-neutral-300">{scenario.description}</div>
                        <div className="col-span-1 px-4 text-gray-600 dark:text-neutral-400 truncate">
                            <RelativeTime date={new Date(scenario.createdAt)} />
                        </div>
                        <div className="col-span-1 px-4 text-gray-600 dark:text-neutral-400 truncate">
                            <RelativeTime date={new Date(scenario.lastUpdatedAt)} />
                        </div>
                    </div>
                ))}
            </div>}
            {total > 1 && <Pagination
                total={total}
                page={page}
                onChange={(page) => {
                    router.push(`/projects/${projectId}/test/scenarios?page=${page}`);
                }}
                className="self-center"
            />}
        </>}
    </div>;
}

export function ScenariosApp({
    projectId,
    slug
}: {
    projectId: string,
    slug: string[]
}) {
    let selection: "list" | "view" | "new" | "edit" = "list";
    let scenarioId: string | null = null;
    if (slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else if (slug[slug.length - 1] === "edit") {
            selection = "edit";
            scenarioId = slug[0];
        } else {
            selection = "view";
            scenarioId = slug[0];
        }
    }

    return <>
        {selection === "list" && <ScenarioList projectId={projectId} />}
        {selection === "new" && <NewScenario projectId={projectId} />}
        {selection === "view" && scenarioId && <ViewScenario projectId={projectId} scenarioId={scenarioId} />}
        {selection === "edit" && scenarioId && <EditScenario projectId={projectId} scenarioId={scenarioId} />}
    </>;
}
import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestProfile, TestScenario, TestSimulation } from "@/app/lib/types/testing_types";
import { useEffect, useState, useRef } from "react";
import { createSimulation, getSimulation, listSimulations, updateSimulation, deleteSimulation, listScenarios, getScenario, getProfile } from "@/app/actions/testing_actions";
import { Button, Input, Pagination, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { PlusIcon, ArrowLeftIcon } from "lucide-react";
import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { RelativeTime } from "@primer/react"
import { ScenarioSelector } from "@/app/lib/components/selectors/scenario-selector";
import { ProfileSelector } from "@/app/lib/components/selectors/profile-selector";

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
    const formRef = useRef<HTMLFormElement>(null);
    const [scenario, setScenario] = useState<WithStringId<z.infer<typeof TestScenario>> | null>(null);
    const [profile, setProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);
    const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

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
            const passCriteria = formData.get("passCriteria") as string;

            if (!name || !passCriteria) {
                throw new Error("Name and Pass Criteria are required");
            }

            if (!scenario) {
                throw new Error("Please select a scenario");
            }

            await updateSimulation(projectId, simulationId, {
                name,
                scenarioId: scenario._id,
                profileId: profile?._id || null,
                passCriteria
            });
            router.push(`/projects/${projectId}/test/simulations/${simulationId}`);
        } catch (error) {
            setError(`Unable to update simulation: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">Edit Simulation</h1>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {error && <div className="bg-red-100 dark:bg-red-900/20 p-2 rounded-md text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onPress={() => formRef.current?.requestSubmit()}>Retry</Button>
        </div>}
        {!loading && simulation && (
            <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
                <Input
                    type="text"
                    name="name"
                    label="Name"
                    placeholder="Enter a name for the simulation"
                    defaultValue={simulation.name}
                    required
                />
                <Input
                    type="text"
                    name="passCriteria"
                    label="Pass Criteria"
                    placeholder="Enter the criteria for passing this simulation"
                    defaultValue={simulation.passCriteria}
                    required
                />
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-neutral-300">Scenario</label>
                    <div className="flex items-center gap-2">
                        {scenario ? (
                            <div className="text-sm text-blue-600 dark:text-blue-400">{scenario.name}</div>
                        ) : (
                            <div className="text-sm text-gray-500 dark:text-neutral-500">No scenario selected</div>
                        )}
                        <Button
                            size="sm"
                            onPress={() => setIsScenarioModalOpen(true)}
                            type="button"
                        >
                            {scenario ? "Change" : "Select"} Scenario
                        </Button>
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-neutral-300">Profile (optional)</label>
                    <div className="flex items-center gap-2">
                        {profile ? (
                            <div className="text-sm text-blue-600 dark:text-blue-400">{profile.name}</div>
                        ) : (
                            <div className="text-sm text-gray-500 dark:text-neutral-500">No profile selected</div>
                        )}
                        {profile && <Button size="sm" variant="bordered" onClick={() => setProfile(null)}>Remove</Button>}
                        <Button
                            size="sm"
                            onPress={() => setIsProfileModalOpen(true)}
                            type="button"
                        >
                            {profile ? "Change" : "Select"} Profile
                        </Button>
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    <FormStatusButton
                        props={{
                            className: "self-start",
                            children: "Update",
                            size: "sm",
                            type: "submit",
                            isDisabled: !scenario,
                        }}
                    />
                    <Button
                        size="sm"
                        variant="flat"
                        as={Link}
                        href={`/projects/${projectId}/test/simulations/${simulationId}`}
                    >
                        Cancel
                    </Button>
                </div>

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
            </form>
        )}
    </div>;
}

function ViewSimulation({
    projectId,
    simulationId,
}: {
    projectId: string,
    simulationId: string,
}) {
    const router = useRouter();
    const [simulation, setSimulation] = useState<WithStringId<z.infer<typeof TestSimulation>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [scenario, setScenario] = useState<WithStringId<z.infer<typeof TestScenario>> | null>(null);
    const [profile, setProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);

    useEffect(() => {
        async function fetchSimulation() {
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
            setLoading(false);
        }
        fetchSimulation();
    }, [simulationId, projectId]);

    async function handleDelete() {
        try {
            await deleteSimulation(projectId, simulationId);
            router.push(`/projects/${projectId}/test/simulations`);
        } catch (error) {
            setDeleteError(`Failed to delete simulation: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">View Simulation</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/simulations`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Simulations
        </Button>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {!loading && !simulation && <div className="text-gray-600 dark:text-neutral-400 text-center">Simulation not found</div>}
        {!loading && simulation && (
            <>
                <div className="flex flex-col gap-1 text-sm">
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Name</div>
                        <div className="flex-[2] dark:text-neutral-200">{simulation.name}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Scenario</div>
                        <div className="flex-[2] dark:text-neutral-200">{scenario?.name || 'Loading...'}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Profile</div>
                        <div className="flex-[2] dark:text-neutral-200">{profile?.name || 'None'}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Pass Criteria</div>
                        <div className="flex-[2] dark:text-neutral-200">{simulation.passCriteria}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Created</div>
                        <div className="flex-[2] dark:text-neutral-300"><RelativeTime date={new Date(simulation.createdAt)} /></div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Last Updated</div>
                        <div className="flex-[2] dark:text-neutral-300"><RelativeTime date={new Date(simulation.lastUpdatedAt)} /></div>
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <Button
                        size="sm"
                        as={Link}
                        href={`/projects/${projectId}/test/simulations/${simulationId}/edit`}
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
                                    Are you sure you want to delete this simulation?
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
            const passCriteria = formData.get("passCriteria") as string;

            if (!name || !passCriteria) {
                throw new Error("Name and Pass Criteria are required");
            }

            if (!scenario) {
                throw new Error("Please select a scenario");
            }

            const result = await createSimulation(projectId, {
                name,
                scenarioId: scenario._id,
                profileId: profile?._id || null,
                passCriteria,
            });
            router.push(`/projects/${projectId}/test/simulations/${result._id}`);
        } catch (error) {
            setError(`Unable to create simulation: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 pb-2 border-b border-gray-200">New Simulation</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/simulations`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Simulations
        </Button>
        {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onClick={() => formRef.current?.requestSubmit()}>Retry</Button>
        </div>}
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
            <Input
                type="text"
                name="name"
                label="Name"
                placeholder="Enter a name for the simulation"
                required
            />
            <Input
                type="text"
                name="passCriteria"
                label="Pass Criteria"
                placeholder="Enter the criteria for passing this simulation"
                required
            />
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Scenario</label>
                <div className="flex items-center gap-2">
                    {scenario ? (
                        <div className="text-sm text-blue-600">{scenario.name}</div>
                    ) : (
                        <div className="text-sm text-gray-500">No scenario selected</div>
                    )}
                    <Button
                        size="sm"
                        onPress={() => setIsScenarioModalOpen(true)}
                        type="button"
                    >
                        {scenario ? "Change" : "Select"} Scenario
                    </Button>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Profile (optional)</label>
                <div className="flex items-center gap-2">
                    {profile ? (
                        <div className="text-sm text-blue-600">{profile.name}</div>
                    ) : (
                        <div className="text-sm text-gray-500">No profile selected</div>
                    )}
                    {profile && <Button size="sm" variant="bordered" onClick={() => setProfile(null)}>Remove</Button>}
                    <Button
                        size="sm"
                        onPress={() => setIsProfileModalOpen(true)}
                        type="button"
                    >
                        {profile ? "Change" : "Select"} Profile
                    </Button>
                </div>
            </div>
            <FormStatusButton
                props={{
                    className: "self-start",
                    children: "Create",
                    size: "sm",
                    type: "submit",
                    isDisabled: !scenario,
                }}
            />
        </form>

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
    </div>;
}

function SimulationList({
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
    const [simulationList, setSimulationList] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>([]);
    const [scenarioMap, setScenarioMap] = useState<Record<string, WithStringId<z.infer<typeof TestScenario>>>>({});
    const [profileMap, setProfileMap] = useState<Record<string, WithStringId<z.infer<typeof TestProfile>>>>({});
    const [total, setTotal] = useState(0);

    useEffect(() => {
        let ignore = false;

        async function fetchSimulation() {
            setLoading(true);
            setError(null);
            try {
                const result = await listSimulations(projectId, page, pageSize);
                if (!ignore) {
                    setSimulationList(result.simulations);
                    setTotal(Math.ceil(result.total / pageSize));
                }
            } catch (error) {
                if (!ignore) {
                    setError(`Unable to fetch simulation: ${error}`);
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        }

        if (error == null) {
            fetchSimulation();
        }

        return () => {
            ignore = true;
        };
    }, [page, pageSize, error, projectId]);

    useEffect(() => {
        let ignore = false;

        async function resolveScenarios() {
            const scenarioIds = simulationList.reduce((acc, simulation) => {
                if (!acc.includes(simulation.scenarioId)) {
                    acc.push(simulation.scenarioId);
                }
                return acc;
            }, [] as string[]);
            const scenarios = await Promise.all(scenarioIds.map((scenarioId) => getScenario(projectId, scenarioId)));
            if (ignore) {
                return;
            }
            setScenarioMap(scenarios.filter((scenario) => scenario !== null).reduce((acc, scenario) => {
                acc[scenario._id] = scenario;
                return acc;
            }, {} as Record<string, WithStringId<z.infer<typeof TestScenario>>>));
        }
        async function resolveProfiles() {
            const profileIds = simulationList.reduce((acc, simulation) => {
                if (simulation.profileId && !acc.includes(simulation.profileId)) {
                    acc.push(simulation.profileId);
                }
                return acc;
            }, [] as string[]);
            const profiles = await Promise.all(profileIds.map((profileId) => getProfile(projectId, profileId)));
            if (ignore) {
                return;
            }
            setProfileMap(profiles.filter((profile) => profile !== null).reduce((acc, profile) => {
                acc[profile._id] = profile;
                return acc;
            }, {} as Record<string, WithStringId<z.infer<typeof TestProfile>>>));
        }

        if (error == null) {
            resolveScenarios();
            resolveProfiles();
        }

        return () => {
            ignore = true;
        };
    }, [simulationList, error, projectId]);

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">Simulations</h1>
        <Button
            size="sm"
            onPress={() => router.push(`/projects/${projectId}/test/simulations/new`)}
            className="self-end"
            startContent={<PlusIcon className="w-4 h-4" />}
        >
            New Simulation
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
            {simulationList.length === 0 && <div className="text-gray-600 dark:text-neutral-400 text-center">No simulations found</div>}
            {simulationList.length > 0 && <div className="flex flex-col w-full">
                {/* Header */}
                <div className="grid grid-cols-9 py-2 bg-gray-100 dark:bg-neutral-800 font-semibold text-sm">
                    <div className="col-span-2 px-4 dark:text-neutral-300">Name</div>
                    <div className="col-span-3 px-4 dark:text-neutral-300">Scenario</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Profile</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Criteria</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Created</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Updated</div>
                </div>

                {/* Rows */}
                {simulationList.map((simulation) => (
                    <div key={simulation._id} className="grid grid-cols-9 py-2 border-b border-gray-200 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800 text-sm">
                        <div className="col-span-2 px-4 truncate">
                            <Link
                                href={`/projects/${projectId}/test/simulations/${simulation._id}`}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                {simulation.name}
                            </Link>
                        </div>
                        <div className="col-span-3 px-4 truncate dark:text-neutral-300">
                            {scenarioMap[simulation.scenarioId]?.name || (
                                <span className="text-gray-500 dark:text-neutral-500 font-mono text-xs">{simulation.scenarioId}</span>
                            )}
                        </div>
                        <div className="col-span-1 px-4 truncate dark:text-neutral-300">
                            {simulation.profileId ? (
                                profileMap[simulation.profileId]?.name || (
                                    <span className="text-gray-500 dark:text-neutral-500 font-mono text-xs">{simulation.profileId}</span>
                                )
                            ) : (
                                <span className="text-gray-500 dark:text-neutral-500 font-mono text-xs">None</span>
                            )}
                        </div>
                        <div className="col-span-1 px-4 truncate dark:text-neutral-300">
                            {simulation.passCriteria}
                        </div>
                        <div className="col-span-1 px-4 text-gray-600 dark:text-neutral-400 truncate">
                            <RelativeTime date={new Date(simulation.createdAt)} />
                        </div>
                        <div className="col-span-1 px-4 text-gray-600 dark:text-neutral-400 truncate">
                            <RelativeTime date={new Date(simulation.lastUpdatedAt)} />
                        </div>
                    </div>
                ))}
            </div>}
            {total > 1 && <Pagination
                total={total}
                page={page}
                onChange={(page) => {
                    router.push(`/projects/${projectId}/test/simulations?page=${page}`);
                }}
                className="self-center"
            />}
        </>}
    </div>;
}

export function SimulationsApp({
    projectId,
    slug
}: {
    projectId: string,
    slug: string[]
}) {
    let selection: "list" | "view" | "new" | "edit" = "list";
    let simulationId: string | null = null;
    if (slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else if (slug[slug.length - 1] === "edit") {
            selection = "edit";
            simulationId = slug[0];
        } else {
            selection = "view";
            simulationId = slug[0];
        }
    }

    return <>
        {selection === "list" && <SimulationList projectId={projectId} />}
        {selection === "new" && <NewSimulation projectId={projectId} />}
        {selection === "view" && simulationId && <ViewSimulation projectId={projectId} simulationId={simulationId} />}
        {selection === "edit" && simulationId && <EditSimulation projectId={projectId} simulationId={simulationId} />}
    </>;
} 
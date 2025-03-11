import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestProfile } from "@/app/lib/types/testing_types";
import { useEffect, useState, useRef } from "react";
import { createProfile, getProfile, listProfiles, updateProfile, deleteProfile } from "@/app/actions/testing_actions";
import { Button, Input, Pagination, Spinner, Switch, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { PlusIcon, ArrowLeftIcon, StarIcon } from "lucide-react";
import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { RelativeTime } from "@primer/react"
import { getProjectConfig } from "@/app/actions/project_actions";

function EditProfile({
    projectId,
    profileId,
}: {
    projectId: string,
    profileId: string,
}) {
    const router = useRouter();
    const [profile, setProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [mockTools, setMockTools] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        async function fetchProfile() {
            setError(null);
            try {
                const profile = await getProfile(projectId, profileId);
                setProfile(profile);
                setMockTools(profile?.mockTools || false);
            } catch (error) {
                setError(`Unable to fetch profile: ${error}`);
            } finally {
                setLoading(false);
            }
        }
        fetchProfile();
    }, [profileId, projectId]);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const context = formData.get("context") as string;
            const mockPrompt = formData.get("mockPrompt") as string;
            await updateProfile(projectId, profileId, {
                name,
                context,
                mockTools,
                mockPrompt: mockPrompt || undefined
            });
            router.push(`/projects/${projectId}/test/profiles/${profileId}`);
        } catch (error) {
            setError(`Unable to update profile: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">Edit Profile</h1>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {error && <div className="bg-red-100 dark:bg-red-900/20 p-2 rounded-md text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onPress={() => formRef.current?.requestSubmit()}>Retry</Button>
        </div>}
        {!loading && profile && (
            <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
                <Input
                    type="text"
                    name="name"
                    label="Name"
                    placeholder="Enter a name for the profile"
                    defaultValue={profile.name}
                    required
                />
                <Textarea
                    name="context"
                    label="Context"
                    placeholder="Enter the context for this profile"
                    defaultValue={profile.context}
                    required
                />
                <Switch
                    name="mockTools"
                    isSelected={mockTools}
                    onValueChange={(value) => {
                        setMockTools(value);
                    }}
                    className="self-start"
                >
                    Mock Tools
                </Switch>
                {mockTools && <Textarea
                    name="mockPrompt"
                    label="Mock Prompt (Optional)"
                    placeholder="Enter a mock prompt"
                    defaultValue={profile.mockPrompt}
                />}
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
                        href={`/projects/${projectId}/test/profiles/${profileId}`}
                    >
                        Cancel
                    </Button>
                </div>
            </form>
        )}
    </div>;
}

function ViewProfile({
    projectId,
    profileId,
}: {
    projectId: string,
    profileId: string,
}) {
    const router = useRouter();
    const [profile, setProfile] = useState<WithStringId<z.infer<typeof TestProfile>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchProfile() {
            const profile = await getProfile(projectId, profileId);
            setProfile(profile);
            setLoading(false);
        }
        fetchProfile();
    }, [projectId, profileId]);

    async function handleDelete() {
        try {
            await deleteProfile(projectId, profileId);
            router.push(`/projects/${projectId}/test/profiles`);
        } catch (error) {
            setDeleteError(`Failed to delete profile: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">View Profile</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/profiles`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Profiles
        </Button>
        {loading && <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
            <Spinner size="sm" />
            Loading...
        </div>}
        {!loading && !profile && <div className="text-gray-600 dark:text-neutral-400 text-center">Profile not found</div>}
        {!loading && profile && (
            <>
                <div className="flex flex-col gap-1 text-sm">
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Name</div>
                        <div className="flex-[2] dark:text-neutral-200">{profile.name}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Context</div>
                        <div className="flex-[2] whitespace-pre-wrap dark:text-neutral-200">{profile.context}</div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Mock Tools</div>
                        <div className="flex-[2] dark:text-neutral-200">{profile.mockTools ? "Yes" : "No"}</div>
                    </div>
                    {profile.mockPrompt && (
                        <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                            <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Mock Prompt</div>
                            <div className="flex-[2] whitespace-pre-wrap dark:text-neutral-200">{profile.mockPrompt}</div>
                        </div>
                    )}
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Created</div>
                        <div className="flex-[2] dark:text-neutral-300"><RelativeTime date={new Date(profile.createdAt)} /></div>
                    </div>
                    <div className="flex border-b border-gray-200 dark:border-neutral-800 py-2">
                        <div className="flex-[1] font-medium text-gray-600 dark:text-neutral-400">Last Updated</div>
                        <div className="flex-[2] dark:text-neutral-300"><RelativeTime date={new Date(profile.lastUpdatedAt)} /></div>
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <Button
                        size="sm"
                        as={Link}
                        href={`/projects/${projectId}/test/profiles/${profileId}/edit`}
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
                                    Are you sure you want to delete this profile?
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

function NewProfile({
    projectId,
}: {
    projectId: string,
}) {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [mockTools, setMockTools] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const context = formData.get("context") as string;
            const mockPrompt = formData.get("mockPrompt") as string;
            const profile = await createProfile(projectId, {
                name,
                context,
                mockTools,
                mockPrompt: mockPrompt || undefined
            });
            router.push(`/projects/${projectId}/test/profiles/${profile._id}`);
        } catch (error) {
            setError(`Unable to create profile: ${error}`);
        }
    }

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 pb-2 border-b border-gray-200">New Profile</h1>
        <Button
            size="sm"
            className="self-start"
            as={Link}
            href={`/projects/${projectId}/test/profiles`}
            startContent={<ArrowLeftIcon className="w-4 h-4" />}
        >
            All Profiles
        </Button>
        {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
            {error}
            <Button size="sm" color="danger" onPress={() => formRef.current?.requestSubmit()}>Retry</Button>
        </div>}
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
            <Input
                type="text"
                name="name"
                label="Name"
                placeholder="Enter a name for the profile"
                required
            />
            <Textarea
                name="context"
                label="Context"
                placeholder="Enter the context for this profile"
                required
            />
            <Switch
                name="mockTools"
                isSelected={mockTools}
                onValueChange={(value) => {
                    setMockTools(value);
                }}
                className="self-start"
            >
                Mock Tools
            </Switch>
            {mockTools && <Textarea
                name="mockPrompt"
                label="Mock Prompt (Optional)"
                placeholder="Enter a mock prompt"
            />}
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

function ProfileList({
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
    const [profiles, setProfiles] = useState<WithStringId<z.infer<typeof TestProfile>>[]>([]);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        let ignore = false;

        async function fetchProfiles() {
            setLoading(true);
            setError(null);
            try {
                const profiles = await listProfiles(projectId, page, pageSize);
                if (!ignore) {
                    setProfiles(profiles.profiles);
                    setTotal(Math.ceil(profiles.total / pageSize));
                }
            } catch (error) {
                if (!ignore) {
                    setError(`Unable to fetch profiles: ${error}`);
                }
            } finally {
                if (!ignore) {
                    setLoading(false);
                }
            }
        }

        if (error == null) {
            fetchProfiles();
        }

        return () => {
            ignore = true;
        };
    }, [page, pageSize, error, projectId]);

    return <div className="h-full flex flex-col gap-2">
        <h1 className="text-medium font-bold text-gray-800 dark:text-neutral-200 pb-2 border-b border-gray-200 dark:border-neutral-800">Profiles</h1>
        <Button
            size="sm"
            onPress={() => router.push(`/projects/${projectId}/test/profiles/new`)}
            className="self-end"
            startContent={<PlusIcon className="w-4 h-4" />}
        >
            New Profile
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
            {profiles.length === 0 && <div className="text-gray-600 dark:text-neutral-400 text-center">No profiles found</div>}
            {profiles.length > 0 && <div className="flex flex-col w-full">
                {/* Header */}
                <div className="grid grid-cols-8 py-2 bg-gray-100 dark:bg-neutral-800 font-semibold text-sm">
                    <div className="col-span-2 px-4 dark:text-neutral-300">Name</div>
                    <div className="col-span-3 px-4 dark:text-neutral-300">Context</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Mock Tools</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Created</div>
                    <div className="col-span-1 px-4 dark:text-neutral-300">Updated</div>
                </div>

                {/* Rows */}
                {profiles.map((profile) => (
                    <div key={profile._id} className="grid grid-cols-8 py-2 border-b border-gray-200 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800 text-sm">
                        <div className="col-span-2 px-4 truncate">
                            <Link
                                href={`/projects/${projectId}/test/profiles/${profile._id}`}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                {profile.name}
                            </Link>
                        </div>
                        <div className="col-span-3 px-4 truncate dark:text-neutral-300">{profile.context}</div>
                        <div className="col-span-1 px-4 dark:text-neutral-300">{profile.mockTools ? "Yes" : "No"}</div>
                        <div className="col-span-1 px-4 text-gray-600 dark:text-neutral-400 truncate">
                            <RelativeTime date={new Date(profile.createdAt)} />
                        </div>
                        <div className="col-span-1 px-4 text-gray-600 dark:text-neutral-400 truncate">
                            <RelativeTime date={new Date(profile.lastUpdatedAt)} />
                        </div>
                    </div>
                ))}
            </div>}
            {total > 1 && <Pagination
                total={total}
                page={page}
                onChange={(page) => {
                    router.push(`/projects/${projectId}/test/profiles?page=${page}`);
                }}
                className="self-center"
            />}
        </>}
    </div>;
}

export function ProfilesApp({
    projectId,
    slug
}: {
    projectId: string,
    slug: string[]
}) {
    let selection: "list" | "view" | "new" | "edit" = "list";
    let profileId: string | null = null;
    if (slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else if (slug[slug.length - 1] === "edit") {
            selection = "edit";
            profileId = slug[0];
        } else {
            selection = "view";
            profileId = slug[0];
        }
    }

    return <>
        {selection === "list" && <ProfileList projectId={projectId} />}
        {selection === "new" && <NewProfile projectId={projectId} />}
        {selection === "view" && profileId && <ViewProfile projectId={projectId} profileId={profileId} />}
        {selection === "edit" && profileId && <EditProfile projectId={projectId} profileId={profileId} />}
    </>;
}
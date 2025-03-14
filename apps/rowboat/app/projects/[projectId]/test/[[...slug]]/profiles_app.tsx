"use client";

import Link from "next/link";
import { WithStringId } from "@/app/lib/types/types";
import { TestProfile } from "@/app/lib/types/testing_types";
import { useEffect, useState, useRef } from "react";
import { createProfile, getProfile, listProfiles, updateProfile, deleteProfile } from "@/app/actions/testing_actions";
import { Button, Spinner, Selection } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { PlusIcon } from "lucide-react";
import { RelativeTime } from "@primer/react"
import { StructuredPanel, ActionButton } from "@/app/lib/components/structured-panel";
import { DataTable } from "./components/table";
import { isValidDate } from './utils/date';
import { ProfileForm } from "./components/profile-form";

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
            const mockTools = formData.get("mockTools") === "on";
            const mockPrompt = formData.get("mockPrompt") as string;

            await updateProfile(projectId, profileId, { 
                name, 
                context, 
                mockTools,
                mockPrompt: mockTools && mockPrompt ? mockPrompt : undefined
            });
            router.push(`/projects/${projectId}/test/profiles`);
        } catch (error) {
            setError(`Unable to update profile: ${error}`);
        }
    }

    return <StructuredPanel 
        title="EDIT PROFILE"
        tooltip="Edit an existing test profile"
    >
        <div className="flex flex-col gap-6 max-w-2xl">
            {loading && (
                <div className="flex gap-2 items-center text-gray-600 dark:text-neutral-400">
                    <Spinner size="sm" />
                    Loading profile...
                </div>
            )}
            
            {error && (
                <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                    {error}
                    <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                </div>
            )}

            {!loading && profile && (
                <ProfileForm
                    formRef={formRef}
                    handleSubmit={handleSubmit}
                    onCancel={() => router.push(`/projects/${projectId}/test/profiles`)}
                    submitButtonText="Update Profile"
                    defaultValues={{
                        name: profile.name,
                        context: profile.context,
                        mockTools: Boolean(profile.mockTools),
                        mockPrompt: profile.mockPrompt || ""
                    }}
                />
            )}
        </div>
    </StructuredPanel>;
}

function NewProfile({ projectId }: { projectId: string }) {
    const formRef = useRef<HTMLFormElement>(null);
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(formData: FormData) {
        setError(null);
        try {
            const name = formData.get("name") as string;
            const context = formData.get("context") as string;
            const mockTools = formData.get("mockTools") === "on";
            const mockPrompt = mockTools ? (formData.get("mockPrompt") as string) : undefined;
            
            await createProfile(projectId, { 
                name, 
                context, 
                mockTools,
                mockPrompt // This will be undefined if mockTools is false
            });
            router.push(`/projects/${projectId}/test/profiles`);
        } catch (error) {
            setError(`Unable to create profile: ${error}`);
        }
    }

    return <StructuredPanel 
        title="NEW PROFILE"
        tooltip="Create a new test profile"
    >
        <div className="flex flex-col gap-6 max-w-2xl">
            <ProfileForm
                formRef={formRef}
                handleSubmit={handleSubmit}
                onCancel={() => router.push(`/projects/${projectId}/test/profiles`)}
                submitButtonText="Create Profile"
            />
        </div>
    </StructuredPanel>;
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
    const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set<string>());
    const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

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

    const handleSelectionChange = (selection: Selection) => {
        if (selection === "all" && 
            selectedKeys !== "all" && 
            (selectedKeys as Set<string>).size > 0) {
            setSelectedKeys(new Set());
            setSelectedProfiles([]);
        } else {
            setSelectedKeys(selection);
            if (selection === "all") {
                setSelectedProfiles(profiles.map(profile => profile._id));
            } else {
                setSelectedProfiles(Array.from(selection as Set<string>));
            }
        }
    };

    const handleDelete = async (profileId: string) => {
        try {
            await deleteProfile(projectId, profileId);
            // Refresh the profiles list after deletion
            const result = await listProfiles(projectId, page, pageSize);
            setProfiles(result.profiles);
            setTotal(result.total);
        } catch (err) {
            setError(`Failed to delete profile: ${err}`);
        }
    };

    const columns = [
        {
            key: 'name',
            label: 'NAME',
            render: (profile: any) => profile.name
        },
        {
            key: 'context',
            label: 'CONTEXT'
        },
        {
            key: 'mockTools',
            label: 'MOCK TOOLS',
            render: (profile: any) => profile.mockTools ? "Yes" : "No"
        },
        {
            key: 'createdAt',
            label: 'CREATED',
            render: (profile: any) => profile?.createdAt && isValidDate(profile.createdAt) ? 
                <RelativeTime date={new Date(profile.createdAt)} /> : 
                'Invalid date'
        },
        {
            key: 'lastUpdatedAt',
            label: 'LAST UPDATED',
            render: (profile: any) => profile?.lastUpdatedAt && isValidDate(profile.lastUpdatedAt) ? 
                <RelativeTime date={new Date(profile.lastUpdatedAt)} /> : 
                'Invalid date'
        }
    ];

    return <StructuredPanel 
        title="PROFILES"
        tooltip="View and manage your test profiles"
    >
        <div className="flex flex-col gap-6 max-w-4xl">
            {/* Header Section */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Profiles</h1>
                    <p className="text-sm text-gray-600 dark:text-neutral-400">
                        Create and manage test profiles for your simulations
                    </p>
                </div>
                <Button
                    size="sm"
                    color="primary"
                    startContent={<PlusIcon size={16} />}
                    onPress={() => router.push(`/projects/${projectId}/test/profiles/new`)}
                >
                    New Profile
                </Button>
            </div>

            {/* Error Display */}
            {error && (
                <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-800 dark:text-red-400 flex items-center gap-2 text-sm">
                    {error}
                    <Button size="sm" color="danger" onPress={() => setError(null)}>Retry</Button>
                </div>
            )}

            {/* Profiles Table */}
            {loading ? (
                <div className="flex gap-2 items-center justify-center p-8 text-gray-600 dark:text-neutral-400">
                    <Spinner size="sm" />
                    Loading profiles...
                </div>
            ) : profiles.length === 0 ? (
                <div className="text-center p-8 bg-gray-50 dark:bg-neutral-900 rounded-lg border border-dashed border-gray-200 dark:border-neutral-800">
                    <p className="text-gray-600 dark:text-neutral-400">No profiles created yet</p>
                </div>
            ) : (
                <DataTable
                    items={profiles}
                    columns={columns}
                    selectedKeys={selectedKeys}
                    onSelectionChange={handleSelectionChange}
                    onDelete={handleDelete}
                    onEdit={(id) => router.push(`/projects/${projectId}/test/profiles/${id}/edit`)}
                    projectId={projectId}
                />
            )}
        </div>
    </StructuredPanel>;
}

export function ProfilesApp({ projectId, slug }: { projectId: string; slug?: string[] }) {
    let selection: "list" | "new" | "edit" = "list";
    let profileId: string | undefined;

    if (slug && slug.length > 0) {
        if (slug[0] === "new") {
            selection = "new";
        } else if (slug[1] === "edit") {
            selection = "edit";
            profileId = slug[0];
        } else {
            selection = "list";
            profileId = slug[0];
        }
    }

    return (
        <div className="h-full">
            {selection === "list" && <ProfileList projectId={projectId} />}
            {selection === "new" && <NewProfile projectId={projectId} />}
            {selection === "edit" && profileId && (
                <EditProfile projectId={projectId} profileId={profileId} />
            )}
        </div>
    );
}

export { NewProfile, EditProfile };
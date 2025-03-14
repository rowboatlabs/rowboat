import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { Button, Input, Textarea } from "@heroui/react";
import { TestProfile, TestScenario } from "@/app/lib/types/testing_types";
import { WithStringId } from "@/app/lib/types/types";
import { ScenarioSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/scenario-selector";
import { ProfileSelector } from "@/app/projects/[projectId]/test/[[...slug]]/components/selectors/profile-selector";
import { z } from "zod";

interface SimulationFormProps {
    formRef: React.RefObject<HTMLFormElement>;
    handleSubmit: (formData: FormData) => Promise<void>;
    scenario: WithStringId<z.infer<typeof TestScenario>> | null;
    setScenario: (scenario: WithStringId<z.infer<typeof TestScenario>> | null) => void;
    profile: WithStringId<z.infer<typeof TestProfile>> | null;
    setProfile: (profile: WithStringId<z.infer<typeof TestProfile>> | null) => void;
    isScenarioModalOpen: boolean;
    setIsScenarioModalOpen: (isOpen: boolean) => void;
    isProfileModalOpen: boolean;
    setIsProfileModalOpen: (isOpen: boolean) => void;
    projectId: string;
    submitButtonText: string;
    defaultValues?: {
        name?: string;
        description?: string;
        passCriteria?: string;
    };
    onCancel: () => void;
}

export function SimulationForm({
    formRef,
    handleSubmit,
    scenario,
    setScenario,
    profile,
    setProfile,
    isScenarioModalOpen,
    setIsScenarioModalOpen,
    isProfileModalOpen,
    setIsProfileModalOpen,
    projectId,
    submitButtonText,
    defaultValues = {},
    onCancel,
}: SimulationFormProps) {
    return (
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-6">
            {/* Basic Information */}
            <div className="flex flex-col gap-4 p-4 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800">
                <h2 className="text-sm font-medium">Basic Information</h2>
                <Input
                    type="text"
                    name="name"
                    label={<span>Name</span>}
                    placeholder="Enter a name for the simulation, e.g. &quot;Frequent buyer cancelling order&quot;"
                    defaultValue={defaultValues.name}
                    isRequired
                    classNames={{
                        input: "bg-white dark:bg-neutral-900",
                        inputWrapper: "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800"
                    }}
                />
                <Textarea
                    name="description"
                    label={<span>Description</span>}
                    placeholder="Enter an optional description for the simulation, just to help you remember what it's for"
                    defaultValue={defaultValues.description}
                    classNames={{
                        input: "bg-white dark:bg-neutral-900",
                        inputWrapper: "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800"
                    }}
                />
            </div>

            {/* Test Configuration */}
            <div className="flex flex-col gap-6 p-6 bg-white dark:bg-neutral-900 rounded-lg border border-gray-200 dark:border-neutral-800">
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Test Configuration</h2>
                
                <div className="flex flex-col gap-6">
                    {/* Scenario Selection */}
                    <div className="flex flex-col gap-3">
                        <label className="text-sm font-medium text-gray-900 dark:text-white">
                            Scenario <span className="text-red-500">*</span>
                        </label>
                        <div className="flex items-center gap-1.5 min-h-[2rem]">
                            <div className="flex-1 text-sm text-gray-600 dark:text-neutral-400">
                                {scenario ? (
                                    <span className="text-blue-600 dark:text-blue-400">{scenario.name}</span>
                                ) : (
                                    <span className="text-red-500">No scenario selected</span>
                                )}
                            </div>
                            <Button
                                size="sm"
                                onPress={() => setIsScenarioModalOpen(true)}
                                type="button"
                            >
                                {scenario ? "Change" : "Select"} Scenario
                            </Button>
                        </div>
                    </div>

                    {/* Profile Selection */}
                    <div className="flex flex-col gap-3">
                        <label className="text-sm font-medium text-gray-900 dark:text-white">
                            Profile <span className="text-gray-500 dark:text-neutral-400">(optional)</span>
                        </label>
                        <div className="flex items-center gap-1.5 min-h-[2rem]">
                            <div className="flex-1 text-sm text-gray-600 dark:text-neutral-400">
                                {profile ? (
                                    <span className="text-blue-600 dark:text-blue-400">{profile.name}</span>
                                ) : (
                                    "No profile selected"
                                )}
                            </div>
                            <div className="flex gap-2">
                                {profile && (
                                    <Button size="sm" variant="bordered" onClick={() => setProfile(null)}>
                                        Remove
                                    </Button>
                                )}
                                <Button
                                    size="sm"
                                    onPress={() => setIsProfileModalOpen(true)}
                                    type="button"
                                >
                                    {profile ? "Change" : "Select"} Profile
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Pass Criteria */}
                    <div className="flex flex-col gap-3">
                        <label className="text-sm font-medium text-gray-900 dark:text-white">
                            Pass Criteria <span className="text-red-500">*</span>
                        </label>
                        <Textarea
                            name="passCriteria"
                            placeholder="Define the criteria for this test to pass, e.g. &quot;The assistant should successfully cancel the user's order and provide next steps for the user to confirm the cancellation&quot;"
                            defaultValue={defaultValues.passCriteria}
                            isRequired
                            minRows={3}
                            classNames={{
                                base: "w-full",
                                input: "bg-white dark:bg-neutral-900 resize-none",
                                inputWrapper: "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700 transition-colors"
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Submit Button */}
            <div className="flex gap-3">
                <FormStatusButton
                    props={{
                        children: submitButtonText,
                        size: "md",
                        color: "primary",
                        type: "submit",
                        isDisabled: !scenario,
                        className: "font-medium"
                    }}
                />
                <Button
                    size="md"
                    variant="flat"
                    onPress={onCancel}
                    className="font-medium"
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
    );
} 
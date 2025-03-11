import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { Button, Input, Textarea, Switch } from "@heroui/react"
import { useRef, useState } from "react";

interface ProfileFormProps {
    defaultValues?: {
        name?: string;
        context?: string;
        mockTools?: boolean;
        mockPrompt?: string;
    };
    formRef: React.RefObject<HTMLFormElement>;
    handleSubmit: (formData: FormData) => Promise<void>;
    onCancel: () => void;
    submitButtonText: string;
}

export function ProfileForm({
    defaultValues = {},
    formRef,
    handleSubmit,
    onCancel,
    submitButtonText,
}: ProfileFormProps) {
    const [mockTools, setMockTools] = useState(Boolean(defaultValues.mockTools));
    const [showMockPrompt, setShowMockPrompt] = useState(Boolean(defaultValues.mockTools));

    return (
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-6">
            <Input
                label="Name"
                name="name"
                placeholder="Provide a name to describe the user's profile to simulate, e.g. &quot;Frequent buyer&quot;"
                defaultValue={defaultValues.name}
                isRequired
            />

            <Textarea
                label="Context"
                name="context"
                placeholder="Provide user info and other info to simulate, e.g. &quot;User's name: John Smith. Buying frequency: 10 orders a month. Location: US. Latest order: Pair of Jeans - XL.&quot;"
                defaultValue={defaultValues.context}
                isRequired
            />

            <Switch
                isSelected={mockTools}
                onValueChange={(checked) => {
                    setMockTools(checked);
                    setShowMockPrompt(checked);
                }}
                name="mockTools"
                value="on"
            >
                Mock Tools
            </Switch>

            {showMockPrompt && (
                <div className="rounded-lg border border-gray-200 dark:border-neutral-800 p-4">
                    <div className="text-sm font-medium mb-2">Mock Prompt (Optional)</div>
                    <Textarea
                        name="mockPrompt"
                        placeholder="Enter a mock prompt"
                        defaultValue={defaultValues.mockPrompt}
                    />
                </div>
            )}

            <div className="flex gap-3">
                <FormStatusButton
                    props={{
                        children: submitButtonText,
                        size: "md",
                        color: "primary",
                        type: "submit",
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
        </form>
    );
} 
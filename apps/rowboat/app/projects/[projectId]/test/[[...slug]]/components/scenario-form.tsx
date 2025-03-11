import { FormStatusButton } from "@/app/lib/components/form-status-button";
import { Button, Input, Textarea } from "@heroui/react";

interface ScenarioFormProps {
    formRef: React.RefObject<HTMLFormElement>;
    handleSubmit: (formData: FormData) => Promise<void>;
    onCancel: () => void;
    submitButtonText: string;
    defaultValues?: {
        name?: string;
        description?: string;
    };
}

export function ScenarioForm({
    formRef,
    handleSubmit,
    onCancel,
    submitButtonText,
    defaultValues = {},
}: ScenarioFormProps) {
    return (
        <form ref={formRef} action={handleSubmit} className="flex flex-col gap-6">
            <Input
                type="text"
                name="name"
                label="Name"
                placeholder="Provide a name for this scenario, e.g. &quot;Order cancellation&quot;"
                defaultValue={defaultValues.name}
                isRequired
                classNames={{
                    input: "bg-white dark:bg-neutral-900",
                    inputWrapper: "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800"
                }}
            />
            <Textarea
                name="description"
                label="Description"
                placeholder="Describe the scenario that should be simulated, e.g. &quot;Role play a user who wants to cancel their recently ordered pair of jeans.&quot;"
                defaultValue={defaultValues.description}
                isRequired
                classNames={{
                    input: "bg-white dark:bg-neutral-900",
                    inputWrapper: "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800"
                }}
            />
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
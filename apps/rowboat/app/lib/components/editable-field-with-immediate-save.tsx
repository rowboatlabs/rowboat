import { Button, Input, Textarea } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { useClickAway } from "../../../hooks/use-click-away";
import MarkdownContent from "./markdown-content";
import clsx from "clsx";
import { Label } from "./label";
import { SparklesIcon } from "lucide-react";

interface EditableFieldProps {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    markdown?: boolean;
    multiline?: boolean;
    locked?: boolean;
    className?: string;
    validate?: (value: string) => { valid: boolean; errorMessage?: string };
    light?: boolean;
    error?: string | null;
    inline?: boolean;
    showGenerateButton?: {
        show: boolean;
        setShow: (show: boolean) => void;
    };
    disabled?: boolean;
    type?: string;
}

export function EditableField({
    value,
    onChange,
    label,
    placeholder = "Click to edit...",
    markdown = false,
    multiline = false,
    locked = false,
    className = "flex flex-col gap-1 w-full",
    validate,
    light = false,
    error,
    inline = false,
    showGenerateButton,
    disabled = false,
    type = "text",
}: EditableFieldProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const ref = useRef<HTMLDivElement>(null);

    const validationResult = validate?.(localValue);
    const isValid = !validate || validationResult?.valid;

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useClickAway(ref, () => {
        if (isEditing) {
            if (isValid && localValue !== value) {
                onChange(localValue);
            } else {
                setLocalValue(value);
            }
            setIsEditing(false);
        }
    });

    const onValueChange = (newValue: string) => {
        setLocalValue(newValue);
        onChange(newValue);  // Always save immediately
    };

    const commonProps = {
        autoFocus: true,
        value: localValue,
        onValueChange: onValueChange,
        variant: "bordered" as const,
        labelPlacement: "outside" as const,
        placeholder: markdown ? '' : placeholder,
        classNames: {
            input: "rounded-md",
            inputWrapper: "rounded-md border-medium"
        },
        radius: "md" as const,
        isInvalid: !isValid,
        errorMessage: validationResult?.errorMessage,
        onKeyDown: (e: React.KeyboardEvent) => {
            if (!multiline && e.key === "Enter") {
                e.preventDefault();
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
                setIsEditing(false);
            }
            if (e.key === "Escape") {
                setLocalValue(value);
                setIsEditing(false);
            }
        },
    };

    if (isEditing) {
        return (
            <div ref={ref} className={clsx("flex flex-col gap-1 w-full", className)}>
                {label && (
                    <div className="flex justify-between items-center">
                        <Label label={label} />
                        <div className="flex gap-2 items-center">
                            {showGenerateButton && (
                                <Button
                                    variant="light"
                                    size="sm"
                                    startContent={<SparklesIcon size={16} />}
                                    onPress={() => showGenerateButton.setShow(true)}
                                >
                                    Generate
                                </Button>
                            )}
                        </div>
                    </div>
                )}
                {multiline && <Textarea
                    {...commonProps}
                    minRows={3}
                    maxRows={20}
                    className="w-full"
                    classNames={{
                        ...commonProps.classNames,
                        input: "rounded-md py-2",
                        inputWrapper: "rounded-md border-medium py-1"
                    }}
                />}
                {!multiline && <Input 
                    {...commonProps} 
                    type={type}
                    className="w-full"
                    classNames={{
                        ...commonProps.classNames,
                        input: "rounded-md py-2",
                        inputWrapper: "rounded-md border-medium py-1"
                    }}
                />}
            </div>
        );
    }

    return (
        <div ref={ref} className={clsx("cursor-text", className)}>
            {label && (
                <div className="flex justify-between items-center">
                    <Label label={label} />
                    {showGenerateButton && (
                        <Button
                            variant="light"
                            size="sm"
                            startContent={<SparklesIcon size={16} />}
                            onPress={() => showGenerateButton.setShow(true)}
                        >
                            Generate
                        </Button>
                    )}
                </div>
            )}
            <div
                className={clsx(
                    {
                        "border border-gray-300 dark:border-gray-600 rounded px-3 py-3": !inline,
                        "bg-transparent focus:outline-none focus:ring-0 border-0 rounded-none text-gray-900 dark:text-gray-100": inline,
                    }
                )}
                style={inline ? {
                    border: 'none',
                    borderRadius: '0',
                    padding: '0'
                } : undefined}
                onClick={() => !locked && setIsEditing(true)}
            >
                {value ? (
                    <>
                        {markdown && <div className="max-h-[420px] overflow-y-auto">
                            <MarkdownContent content={value} />
                        </div>}
                        {!markdown && <div className={`${multiline ? 'whitespace-pre-wrap max-h-[420px] overflow-y-auto' : 'flex items-center'}`}>
                            {value}
                        </div>}
                    </>
                ) : (
                    <>
                        {markdown && <div className="max-h-[420px] overflow-y-auto text-gray-400">
                            <MarkdownContent content={placeholder} />
                        </div>}
                        {!markdown && <span className="text-gray-400">{placeholder}</span>}
                    </>
                )}
                {error && (
                    <div className="text-xs text-red-500 mt-1">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
} 
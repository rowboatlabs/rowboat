import { Button, Input, Textarea, Chip, Select, SelectItem, Checkbox } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { useClickAway } from "../../../hooks/use-click-away";
import MarkdownContent from "./markdown-content";
import clsx from "clsx";
import { Label } from "./label";
import dynamic from "next/dynamic";
import { Match } from "./mentions_editor";
import { SparklesIcon, Edit3Icon, XIcon, CheckIcon } from "lucide-react";
import { EntitySelectionContext } from "../../projects/[projectId]/workflow/workflow_editor";
import { useContext } from "react";

const MentionsEditor = dynamic(() => import('./mentions_editor'), { ssr: false });

// Base InputField interface
interface BaseInputFieldProps {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
    className?: string;
    validate?: (value: string) => { valid: boolean; errorMessage?: string };
    error?: string | null;
    disabled?: boolean;
    locked?: boolean;
    inline?: boolean;
    showGenerateButton?: {
        show: boolean;
        setShow: (show: boolean) => void;
    };
    onMentionNavigate?: (type: 'agent' | 'tool' | 'prompt', name: string) => void;
}

// Text input specific props
interface TextInputFieldProps extends BaseInputFieldProps {
    type: 'text';
    multiline?: boolean;
    markdown?: boolean;
    mentions?: boolean;
    mentionsAtValues?: Match[];
    showSaveButton?: boolean;
    showDiscardButton?: boolean;
    immediateSave?: boolean;
}

// Select input specific props
interface SelectInputFieldProps extends BaseInputFieldProps {
    type: 'select';
    options: { key: string; label: string; disabled?: boolean }[];
    selectedKeys?: Set<string>;
    onSelectionChange: (keys: any) => void;
}

// Checkbox input specific props
interface CheckboxInputFieldProps extends BaseInputFieldProps {
    type: 'checkbox';
    isSelected?: boolean;
    onValueChange?: (value: boolean) => void;
}

// Number input specific props
interface NumberInputFieldProps extends BaseInputFieldProps {
    type: 'number';
    min?: number;
    max?: number;
    step?: number;
    immediateSave?: boolean;
}

// Union type for all input field types
type InputFieldProps = TextInputFieldProps | SelectInputFieldProps | CheckboxInputFieldProps | NumberInputFieldProps;

export function InputField(props: InputFieldProps) {
    // Handle different input types
    if (props.type === 'select') {
        return <SelectInputField {...props} />;
    }
    
    if (props.type === 'checkbox') {
        return <CheckboxInputField {...props} />;
    }
    
    if (props.type === 'number') {
        return <NumberInputField {...props} />;
    }
    
    // Default to text input
    return <TextInputField {...props} />;
}

// Text Input Field Component
function TextInputField({
    value,
    onChange,
    label,
    placeholder = "Click to edit...",
    className = "flex flex-col gap-1 w-full",
    validate,
    error,
    disabled = false,
    locked = false,
    inline = false,
    showGenerateButton,
    onMentionNavigate,
    multiline = false,
    markdown = false,
    mentions = false,
    mentionsAtValues = [],
    showSaveButton = false,
    showDiscardButton = false,
    immediateSave = false,
}: TextInputFieldProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const ref = useRef<HTMLDivElement>(null);

    // Use the context directly, will be undefined if not in provider
    const entitySelection = useContext(EntitySelectionContext);

    const validationResult = validate?.(localValue);
    const isValid = !validate || validationResult?.valid;

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useClickAway(ref, () => {
        if (isEditing) {
            if (immediateSave) {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
            } else {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                } else {
                    setLocalValue(value);
                }
            }
        }
        setIsEditing(false);
    });

    const handleMentionNavigate = onMentionNavigate || ((type, name) => {
        if (entitySelection) {
            if (type === 'agent') entitySelection.onSelectAgent(name);
            else if (type === 'tool') entitySelection.onSelectTool(name);
            else if (type === 'prompt') entitySelection.onSelectPrompt(name);
        }
    });

    const handleSave = () => {
        if (isValid && localValue !== value) {
            onChange(localValue);
        }
        setIsEditing(false);
    };

    const handleDiscard = () => {
        setLocalValue(value);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!multiline && e.key === "Enter") {
            e.preventDefault();
            if (immediateSave) {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
            } else {
                handleSave();
            }
        }
        if (e.key === "Escape") {
            handleDiscard();
        }
    };

    const onValueChange = (newValue: string) => {
        setLocalValue(newValue);
        if (immediateSave) {
            onChange(newValue);
        }
    };

    // Determine input size based on content length and multiline
    const getInputSize = () => {
        if (multiline) {
            if (localValue.length > 1000) return "lg";
            if (localValue.length > 500) return "md";
            return "sm";
        }
        return "sm";
    };

    // Determine if we should show action buttons
    const hasChanges = localValue !== value;
    const showActions = hasChanges && (showSaveButton || showDiscardButton);

    if (isEditing) {
        return (
            <div ref={ref} className={clsx("flex flex-col gap-2 w-full", className)}>
                {/* Header with label and action buttons */}
                {(label || showGenerateButton || showActions) && (
                    <div className="flex justify-between items-center">
                        {label && <Label label={label} />}
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
                            {showActions && (
                                <>
                                    {showDiscardButton && (
                                        <Button
                                            variant="light"
                                            size="sm"
                                            onPress={handleDiscard}
                                            startContent={<XIcon size={16} />}
                                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                                        >
                                            Discard
                                        </Button>
                                    )}
                                    {showSaveButton && (
                                        <Button
                                            color="primary"
                                            size="sm"
                                            onPress={handleSave}
                                            startContent={<CheckIcon size={16} />}
                                            isDisabled={!isValid}
                                        >
                                            Save
                                        </Button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Input field */}
                {mentions ? (
                    <div className="w-full min-h-[300px]">
                        <MentionsEditor
                            atValues={mentionsAtValues}
                            value={localValue}
                            placeholder={placeholder}
                            onValueChange={setLocalValue}
                            autoFocus
                        />
                    </div>
                ) : multiline ? (
                    <Textarea
                        value={localValue}
                        onValueChange={onValueChange}
                        placeholder={placeholder}
                        variant="bordered"
                        size={getInputSize()}
                        minRows={12}
                        maxRows={20}
                        isInvalid={!isValid}
                        errorMessage={validationResult?.errorMessage}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        classNames={{
                            input: "text-sm focus:outline-none focus:ring-0",
                            inputWrapper: "border-gray-200 dark:border-gray-700 focus-within:ring-0 focus-within:outline-none",
                        }}
                    />
                ) : (
                    <Input
                        value={localValue}
                        onValueChange={onValueChange}
                        placeholder={placeholder}
                        variant="bordered"
                        size="sm"
                        isInvalid={!isValid}
                        errorMessage={validationResult?.errorMessage}
                        onKeyDown={handleKeyDown}
                        autoFocus
                        classNames={{
                            input: "text-sm focus:outline-none focus:ring-0",
                            inputWrapper: clsx("border-gray-200 dark:border-gray-700 focus-within:ring-0 focus-within:outline-none", {
                                "border-0 bg-transparent": inline
                            }),
                        }}
                    />
                )}
            </div>
        );
    }

    // Read-only view
    return (
        <div ref={ref} className={clsx("w-full", className)}>
            {/* Header with label and generate button */}
            {(label || showGenerateButton) && (
                <div className="flex justify-between items-center mb-2">
                    {label && <Label label={label} />}
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

            {/* Content display */}
            <div
                className={clsx(
                    "group relative rounded-lg border border-gray-200 dark:border-gray-700 p-3 transition-all duration-200",
                    {
                        "cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800": !locked && !disabled,
                        "cursor-not-allowed opacity-60": locked || disabled,
                        "border-0 bg-transparent p-0": inline,
                        "min-h-[300px]": multiline,
                        "min-h-[40px]": !multiline,
                    }
                )}
                onClick={() => !locked && !disabled && setIsEditing(true)}
            >
                {/* Content */}
                <div className={clsx("text-sm", {
                    "whitespace-pre-wrap": multiline,
                    "flex items-center": !multiline,
                })}>
                    {(mentions ? localValue : value) ? (
                        <>
                            {markdown ? (
                                <div className={clsx("prose prose-sm max-w-none", {
                                    "max-h-[420px] overflow-y-auto": multiline
                                })}>
                                    <MarkdownContent 
                                        content={mentions ? localValue : value} 
                                        atValues={mentionsAtValues} 
                                        onMentionNavigate={handleMentionNavigate} 
                                    />
                                </div>
                            ) : (
                                <div className={clsx({
                                    "whitespace-pre-wrap": multiline,
                                    "max-h-[420px] overflow-y-auto": multiline
                                })}>
                                    <MarkdownContent 
                                        content={mentions ? localValue : value} 
                                        atValues={mentionsAtValues} 
                                        onMentionNavigate={handleMentionNavigate} 
                                    />
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            {markdown ? (
                                <div className="text-gray-400 prose prose-sm max-w-none">
                                    <MarkdownContent content={placeholder} atValues={mentionsAtValues} />
                                </div>
                            ) : (
                                <span className="text-gray-400">{placeholder}</span>
                            )}
                        </>
                    )}
                </div>

                {/* Error display */}
                {error && (
                    <div className="text-xs text-red-500 mt-2">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

// Select Input Field Component
function SelectInputField({
    label,
    options,
    selectedKeys,
    onSelectionChange,
    className = "flex flex-col gap-1 w-full",
    disabled = false,
    locked = false,
}: SelectInputFieldProps) {
    return (
        <div className={clsx("w-full", className)}>
            {label && (
                <div className="mb-2">
                    <Label label={label} />
                </div>
            )}
            <Select
                variant="bordered"
                selectedKeys={selectedKeys}
                onSelectionChange={onSelectionChange}
                isDisabled={disabled || locked}
                size="sm"
                classNames={{
                    trigger: "border-gray-200 dark:border-gray-700 focus-within:ring-0 focus-within:outline-none",
                }}
            >
                {options.map((option) => (
                    <SelectItem 
                        key={option.key} 
                        isDisabled={option.disabled}
                    >
                        {option.label}
                    </SelectItem>
                ))}
            </Select>
        </div>
    );
}

// Checkbox Input Field Component
function CheckboxInputField({
    label,
    isSelected = false,
    onValueChange,
    className = "flex flex-col gap-1 w-full",
    disabled = false,
    locked = false,
}: CheckboxInputFieldProps) {
    return (
        <div className={clsx("w-full", className)}>
            <Checkbox
                isSelected={isSelected}
                onValueChange={onValueChange}
                isDisabled={disabled || locked}
                size="sm"
            >
                {label && <span className="text-sm">{label}</span>}
            </Checkbox>
        </div>
    );
}

// Number Input Field Component
function NumberInputField({
    value,
    onChange,
    label,
    placeholder = "Enter number...",
    className = "flex flex-col gap-1 w-full",
    validate,
    error,
    disabled = false,
    locked = false,
    min,
    max,
    step,
    immediateSave = false,
}: NumberInputFieldProps) {
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
            if (immediateSave) {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
            } else {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                } else {
                    setLocalValue(value);
                }
            }
        }
        setIsEditing(false);
    });

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (immediateSave) {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
            } else {
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
                setIsEditing(false);
            }
        }
        if (e.key === "Escape") {
            setLocalValue(value);
            setIsEditing(false);
        }
    };

    const onValueChange = (newValue: string) => {
        setLocalValue(newValue);
        if (immediateSave) {
            onChange(newValue);
        }
    };

    if (isEditing) {
        return (
            <div ref={ref} className={clsx("flex flex-col gap-2 w-full", className)}>
                {label && (
                    <div className="mb-2">
                        <Label label={label} />
                    </div>
                )}
                <Input
                    value={localValue}
                    onValueChange={onValueChange}
                    placeholder={placeholder}
                    variant="bordered"
                    size="sm"
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    isInvalid={!isValid}
                    errorMessage={validationResult?.errorMessage}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    classNames={{
                        input: "text-sm focus:outline-none focus:ring-0",
                        inputWrapper: "border-gray-200 dark:border-gray-700 focus-within:ring-0 focus-within:outline-none",
                    }}
                />
            </div>
        );
    }

    // Read-only view
    return (
        <div ref={ref} className={clsx("w-full", className)}>
            {label && (
                <div className="mb-2">
                    <Label label={label} />
                </div>
            )}
            <div
                className={clsx(
                    "group relative rounded-lg border border-gray-200 dark:border-gray-700 p-3 min-h-[40px] transition-all duration-200",
                    {
                        "cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800": !locked && !disabled,
                        "cursor-not-allowed opacity-60": locked || disabled,
                    }
                )}
                onClick={() => !locked && !disabled && setIsEditing(true)}
            >
                {/* Content */}
                <div className="text-sm flex items-center">
                    {value ? (
                        <span>{value}</span>
                    ) : (
                        <span className="text-gray-400">{placeholder}</span>
                    )}
                </div>

                {/* Error display */}
                {error && (
                    <div className="text-xs text-red-500 mt-2">
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
} 
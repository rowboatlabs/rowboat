import { Button, Input, InputProps, Kbd, Textarea } from "@nextui-org/react";
import { useEffect, useRef, useState } from "react";
import { useClickAway } from "../../../hooks/use-click-away";
import MarkdownContent from "./markdown-content";
import clsx from "clsx";
import { Label } from "./label";
import dynamic from "next/dynamic";
import { Match } from "./mentions_editor";
const MentionsEditor = dynamic(() => import('./mentions_editor'), { ssr: false });

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
    mentions?: boolean;
    mentionsAtValues?: Match[];
}

export function EditableField({
    value,
    onChange,
    label,
    placeholder = "Click to edit...",
    markdown = false,
    multiline = false,
    locked = false,
    className = "flex flex-col gap-1",
    validate,
    light = false,
    mentions = false,
    mentionsAtValues = [],
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
        }
        setIsEditing(false);
    });

    const commonProps = {
        autoFocus: true,
        value: localValue,
        onValueChange: setLocalValue,
        variant: "bordered" as const,
        labelPlacement: "outside" as const,
        placeholder: markdown ? '' : placeholder,
        radius: "sm" as const,
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
            /* DISABLE shift+enter save for multiline fields
            if (multiline && e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                if (isValid && localValue !== value) {
                    onChange(localValue);
                }
                setIsEditing(false);
            }
            */
            if (e.key === "Escape") {
                setLocalValue(value);
                setIsEditing(false);
            }
        },
    };

    return (
        <div ref={ref} className={clsx("flex flex-col gap-1", className)}>
            {(label || isEditing && multiline) && <div className="flex items-center gap-2 justify-between">
                {label && <Label label={label} />}
                {isEditing && multiline && <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="light"
                        onClick={() => {
                            setLocalValue(value);
                            setIsEditing(false);
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        color="primary"
                        onClick={() => {
                            if (isValid && localValue !== value) {
                                onChange(localValue);
                            }
                            setIsEditing(false);
                        }}
                    >
                        Save
                    </Button>
                </div>}
            </div>}
            {isEditing ? <>
                {mentions && <MentionsEditor
                    atValues={mentionsAtValues}
                    value={value}
                    placeholder={placeholder}
                    onValueChange={setLocalValue}
                />}
                {multiline && !mentions && <Textarea
                    {...commonProps}
                    minRows={3}
                    maxRows={20}
                />}
                {!multiline && <Input {...commonProps} />}
            </> : (
                <div
                    onClick={() => !locked && setIsEditing(true)}
                    className={clsx("text-sm px-2 py-1 rounded-md", {
                        "bg-gray-50": (markdown && !locked) || light,
                        "hover:bg-blue-50 cursor-pointer": light && !locked,
                        "hover:bg-gray-100 cursor-pointer": !light && !locked,
                        "cursor-default": locked,
                    })}
                >
                    {value ? (<>
                        {markdown && <div className="max-h-[420px] overflow-y-auto">
                            <MarkdownContent content={value} />
                        </div>}
                        {!markdown && <div className={`${multiline ? 'whitespace-pre-wrap max-h-[420px] overflow-y-auto' : 'flex items-center'}`}>
                            {value}
                        </div>}
                    </>) : (
                        <>
                            {markdown && <div className="max-h-[420px] overflow-y-auto text-gray-400 italic">
                                <MarkdownContent content={placeholder} />
                            </div>}
                            {!markdown && <span className="text-gray-400 italic">{placeholder}</span>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
} 
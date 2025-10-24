import { TextareaProps } from "@primer/react";

export function Textarea({
    className,
    ...props
}: TextareaProps) {
    return <textarea className={className} {...props} />
}
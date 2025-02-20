import { Divider } from "@nextui-org/react";
import { Label } from "./label";

export function FormSection({
    label,
    children,
    showDivider = false,
}: {
    label?: string;
    children: React.ReactNode;
    showDivider?: boolean;
}) {
    return (
        <>
            <div className="flex flex-col gap-2">
                {label && <Label label={label} />}
                {children}
            </div>
            {showDivider && <Divider className="my-4" />}
        </>
    );
} 
import { Divider } from "@nextui-org/react";

export function FormSection({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <>
            <div className={`flex flex-col gap-4 items-start ${className}`}>
                {children}
            </div>
            <Divider />
        </>
    );
} 
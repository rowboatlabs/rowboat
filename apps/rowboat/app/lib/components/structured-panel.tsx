import clsx from "clsx";
import { InfoIcon } from "lucide-react";
import { Tooltip } from "@nextui-org/react";

export function ActionButton({
    icon = null,
    children,
    onClick = undefined,
    disabled = false,
    primary = false,
}: {
    icon?: React.ReactNode;
    children: React.ReactNode;
    onClick?: () => void | undefined;
    disabled?: boolean;
    primary?: boolean;
}) {
    const onClickProp = onClick ? { onClick } : {};
    return <button
        disabled={disabled}
        className={clsx("rounded-md text-xs flex items-center gap-1 disabled:text-gray-300 hover:text-gray-600", {
            "text-blue-600": primary,
            "text-gray-400": !primary,
        })}
        {...onClickProp}
    >
        {icon}
        {children}
    </button>;
}

export function StructuredPanel({
    title,
    actions = null,
    children,
    fancy = false,
    tooltip = null,
}: {
    title: React.ReactNode;
    actions?: React.ReactNode[] | null;
    children: React.ReactNode;
    fancy?: boolean;
    tooltip?: string | null;
}) {
    return <div className={clsx("h-full flex flex-col overflow-auto rounded-md p-1", {
        "bg-gray-100": !fancy,
        "bg-blue-100": fancy,
    })}>
        <div className="shrink-0 flex justify-between items-center gap-2 px-2 py-1 rounded-t-sm">
            <div className="flex items-center gap-1">
                <div className={clsx("text-xs font-semibold uppercase", {
                    "text-gray-400": !fancy,
                    "text-blue-500": fancy,
                })}>
                    {title}
                </div>
                {tooltip && (
                    <Tooltip 
                        content={tooltip}
                        placement="right"
                        className="cursor-help"
                    >
                        <InfoIcon size={12} className={clsx({
                            "text-gray-400": !fancy,
                            "text-blue-500": fancy,
                        })} />
                    </Tooltip>
                )}
            </div>
            {!actions && <div className="w-4 h-4" />}
            {actions && <div className={clsx("rounded-md hover:text-gray-800 px-2 text-sm flex items-center gap-2", {
                "text-blue-600": fancy,
                "text-gray-400": !fancy,
            })}>
                {actions}
            </div>}
        </div>
        <div className="grow bg-white rounded-md overflow-auto flex flex-col justify-start p-2">
            {children}
        </div>
    </div>;
}
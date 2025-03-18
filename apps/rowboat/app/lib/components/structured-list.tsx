import clsx from "clsx";
import { ActionButton } from "./structured-panel";

export function SectionHeader({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between px-2 py-1 mt-4 first:mt-0 border-b border-gray-200 dark:border-gray-600">
            <div className="text-xs font-semibold text-gray-400 dark:text-gray-300 uppercase">{title}</div>
            <div className="flex items-center gap-3">
                {children}
            </div>
        </div>
    );
}

export function ListItem({
    name,
    isSelected,
    onClick,
    disabled,
    rightElement,
    selectedRef,
    icon
}: {
    name: string;
    isSelected: boolean;
    onClick: () => void;
    disabled?: boolean;
    rightElement?: React.ReactNode;
    selectedRef?: React.RefObject<HTMLButtonElement>;
    icon?: React.ReactNode;
}) {
    return (
        <button
            ref={selectedRef as any}
            onClick={onClick}
            className={clsx("flex items-center justify-between rounded-md px-2 py-1", {
                "bg-gray-100 dark:bg-gray-700": isSelected,
                "hover:bg-gray-50 dark:hover:bg-gray-800": !isSelected,
            })}
        >
            <div className="flex items-center gap-1">
                {icon && <div className="w-4 shrink-0">{icon}</div>}
                <div className={clsx("truncate text-sm dark:text-gray-200", {
                    "text-gray-400 dark:text-gray-500": disabled,
                })}>{name}</div>
            </div>
            {rightElement}
        </button>
    );
} 
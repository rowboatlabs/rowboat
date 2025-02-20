import clsx from "clsx";
import { ActionButton } from "./structured-panel";

export function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
    return (
        <div className="flex items-center justify-between px-2 py-1 mt-4 first:mt-0 border-b border-gray-200 dark:border-gray-600">
            <div className="text-xs font-semibold text-gray-400 dark:text-gray-300 uppercase">{title}</div>
            <ActionButton
                icon={<svg className="w-4 h-4" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                    <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14m-7 7V5" />
                </svg>}
                onClick={onAdd}
            >
                Add
            </ActionButton>
        </div>
    );
}

export function ListItem({ 
    name, 
    isSelected, 
    onClick, 
    disabled,
    rightElement,
    selectedRef 
}: { 
    name: string;
    isSelected: boolean;
    onClick: () => void;
    disabled?: boolean;
    rightElement?: React.ReactNode;
    selectedRef?: React.RefObject<HTMLButtonElement>;
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
            <div className={clsx("truncate text-sm dark:text-gray-200", {
                "text-gray-400 dark:text-gray-500": disabled,
            })}>{name}</div>
            {rightElement}
        </button>
    );
} 
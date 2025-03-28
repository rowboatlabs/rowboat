import clsx from "clsx";
import { InfoIcon } from "lucide-react";
import { Tooltip } from "@heroui/react";
import { useState } from "react";

interface Tab {
    id: string;
    label: React.ReactNode;
    content: React.ReactNode;
}

export interface TabbedPanelProps {
    title: React.ReactNode;
    actions?: React.ReactNode[] | null;
    tabs: Tab[];
    fancy?: boolean;
    tooltip?: string | null;
    defaultTab?: string;
}

export function TabbedPanel({
    title,
    actions = null,
    tabs,
    fancy = false,
    tooltip = null,
    defaultTab,
}: TabbedPanelProps) {
    const [activeTab, setActiveTab] = useState(defaultTab || tabs[0].id);

    return <div className={clsx(
        "h-full flex flex-col overflow-hidden rounded-xl border",
        {
            "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900": !fancy,
            "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950": fancy,
        }
    )}>
        <div className="shrink-0 flex justify-between items-center gap-2 px-4 py-3">
            <div className="flex items-center gap-1">
                <div className={clsx("font-medium", {
                    "text-gray-900 dark:text-gray-100": !fancy,
                    "text-blue-900 dark:text-blue-100": fancy,
                })}>
                    {title}
                </div>
                {tooltip && (
                    <Tooltip 
                        content={tooltip}
                        placement="right"
                        className="cursor-help"
                    >
                        <InfoIcon size={14} className={clsx({
                            "text-gray-400 dark:text-gray-500": !fancy,
                            "text-blue-500 dark:text-blue-400": fancy,
                        })} />
                    </Tooltip>
                )}
            </div>
            {actions && <div className="flex items-center gap-2">
                {actions}
            </div>}
        </div>

        <div className="border-b border-gray-200 dark:border-gray-800">
            <div className="flex gap-4 px-4">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={clsx(
                            "py-2 text-sm font-medium border-b-2 transition-colors",
                            activeTab === tab.id
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
        </div>

        <div className="grow overflow-auto p-4">
            {tabs.find(tab => tab.id === activeTab)?.content}
        </div>
    </div>;
}
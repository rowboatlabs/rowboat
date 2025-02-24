'use client';
import { toggleDataSource } from "../../../actions/datasource_actions";
import { Spinner } from "@nextui-org/react";
import { Switch } from "@nextui-org/react";
import { useState } from "react";

export function ToggleSource({
    projectId,
    sourceId,
    active,
    compact=false,
    className
}: {
    projectId: string;
    sourceId: string;
    active: boolean;
    compact?: boolean;
    className?: string;
}) {
    const [loading, setLoading] = useState(false);
    const [isActive, setIsActive] = useState(active);

    function handleActiveSwitchChange(isSelected: boolean) {
        setIsActive(isSelected);
        setLoading(true);
        toggleDataSource(projectId, sourceId, isSelected)
            .finally(() => {
                setLoading(false);
            });
    }

    return <div className="flex flex-col gap-1 items-start">
        <div className="flex items-center gap-1">
            <Switch
                size="sm"
                isSelected={isActive}
                onValueChange={handleActiveSwitchChange}
                disabled={loading}
                aria-label="Toggle source active state"
                classNames={{
                    wrapper: `light:bg-default-200 dark:bg-default-100 group-data-[selected=true]:bg-primary-500 ${className || ''}`
                }}
            >
                {isActive ? "Active" : "Inactive"}
            </Switch>
            {loading && <Spinner size="sm" />}
        </div>
        {!compact && !isActive && <p className="text-sm text-red-800">This data source will not be used for RAG.</p>}
    </div>;
}
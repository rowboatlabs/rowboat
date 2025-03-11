'use client';

import { useRouter } from "next/navigation";
import { StructuredPanel } from "../../../../lib/components/structured-panel";
import { ListItem } from "../../../../lib/components/structured-list";

export function TestingMenu({
    projectId,
    app,
}: {
    projectId: string;
    app: "scenarios" | "simulations" | "profiles" | "runs";
}) {
    const router = useRouter();

    const menuItems = [
        { 
            label: "Scenarios", 
            href: `/projects/${projectId}/test/scenarios`,
            isSelected: app === "scenarios"
        },
        { 
            label: "Profiles", 
            href: `/projects/${projectId}/test/profiles`,
            isSelected: app === "profiles"
        },
        { 
            label: "Simulations", 
            href: `/projects/${projectId}/test/simulations`,
            isSelected: app === "simulations"
        },
        { 
            label: "Test Runs", 
            href: `/projects/${projectId}/test/runs`,
            isSelected: app === "runs"
        },
    ];

    return (
        <StructuredPanel title="TEST" tooltip="Browse and manage your test scenarios and runs">
            <div className="overflow-auto flex flex-col gap-1 justify-start">
                {menuItems.map((item) => (
                    <ListItem
                        key={item.label}
                        name={item.label}
                        isSelected={item.isSelected}
                        onClick={() => router.push(item.href)}
                    />
                ))}
            </div>
        </StructuredPanel>
    );
} 
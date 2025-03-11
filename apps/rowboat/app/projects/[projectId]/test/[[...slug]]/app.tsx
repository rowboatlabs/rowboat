"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScenariosApp } from "./scenarios_app";
import { ProfilesApp } from "./profiles_app";
import { SimulationsApp } from "./simulations_app";
import { usePathname } from "next/navigation";
import { RunsApp } from "./runs_app";
import { StructuredPanel } from "../../../../lib/components/structured-panel";
import { ListItem } from "../../../../lib/components/structured-list";

export function App({
    projectId,
    slug
}: {
    projectId: string,
    slug?: string[]
}) {
    const router = useRouter();
    const pathname = usePathname();
    let selection: "scenarios" | "profiles" | "criteria" | "simulations" | "runs" = "runs";
    if (!slug || slug.length === 0) {
        router.push(`/projects/${projectId}/test/runs`);
    } else if (slug[0] === "scenarios") {
        selection = "scenarios";
    } else if (slug[0] === "profiles") {
        selection = "profiles";
    } else if (slug[0] === "criteria") {
        selection = "criteria";
    } else if (slug[0] === "simulations") {
        selection = "simulations";
    } else if (slug[0] === "runs") {
        selection = "runs";
    }
    let innerSlug: string[] = [];
    if (slug && slug.length > 1) {
        innerSlug = slug.slice(1);
    }

    const menuItems = [
        { label: "Scenarios", href: `/projects/${projectId}/test/scenarios` },
        { label: "Profiles", href: `/projects/${projectId}/test/profiles` },
        { label: "Simulations", href: `/projects/${projectId}/test/simulations` },
        { label: "Test Runs", href: `/projects/${projectId}/test/runs` },
    ];

    return <div className="flex h-full">
        <StructuredPanel title="TEST" tooltip="Browse and manage your test scenarios and runs">
            <div className="overflow-auto flex flex-col gap-1 justify-start">
                {menuItems.map((item) => (
                    <ListItem
                        key={item.label}
                        name={item.label}
                        isSelected={pathname.startsWith(item.href)}
                        onClick={() => router.push(item.href)}
                    />
                ))}
            </div>
        </StructuredPanel>
        <div className="grow border-l border-gray-200 dark:border-neutral-800 p-2">
            {selection === "scenarios" && <ScenariosApp projectId={projectId} slug={innerSlug} />}
            {selection === "profiles" && <ProfilesApp projectId={projectId} slug={innerSlug} />}
            {selection === "simulations" && <SimulationsApp projectId={projectId} slug={innerSlug} />}
            {selection === "runs" && <RunsApp projectId={projectId} slug={innerSlug} />}
        </div>
    </div>;
}

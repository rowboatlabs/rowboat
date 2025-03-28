"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScenariosApp } from "./scenarios_app";
import { ProfilesApp } from "./profiles_app";
import { SimulationsApp } from "./simulations_app";
import { usePathname } from "next/navigation";
import { RunsApp } from "./runs_app";

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
        <div className="w-40 shrink-0 p-2">
            <ul>
                {menuItems.map((item) => (
                    <li key={item.label}>
                        <Link
                            className={`block p-2 rounded-md text-sm ${pathname.startsWith(item.href) ? "bg-gray-100" : "hover:bg-gray-100"}`}
                            href={item.href}>{item.label}</Link>
                    </li>
                ))}
            </ul>
        </div>
        <div className="grow border-l border-gray-200 p-2">
            {selection === "scenarios" && <ScenariosApp projectId={projectId} slug={innerSlug} />}
            {selection === "profiles" && <ProfilesApp projectId={projectId} slug={innerSlug} />}
            {selection === "simulations" && <SimulationsApp projectId={projectId} slug={innerSlug} />}
            {selection === "runs" && <RunsApp projectId={projectId} slug={innerSlug} />}
        </div>
    </div>;
}

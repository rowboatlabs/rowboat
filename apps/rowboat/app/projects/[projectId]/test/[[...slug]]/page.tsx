'use client';

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ScenariosApp } from "./scenarios_app";
import { SimulationsApp } from "./simulations_app";
import { ProfilesApp } from "./profiles_app";
import { RunsApp } from "./runs_app";
import { TestingMenu } from "./testing_menu";
export default function TestPage({ params }: { params: { projectId: string; slug?: string[] } }) {
    const { projectId, slug = [] } = params;
    let app: "scenarios" | "simulations" | "profiles" | "runs" = "runs";
    
    if (slug[0] === "scenarios") {
        app = "scenarios";
    } else if (slug[0] === "simulations") {
        app = "simulations";
    } else if (slug[0] === "profiles") {
        app = "profiles";
    } else if (slug[0] === "runs") {
        app = "runs";
    }

    return (
        <div className="h-full flex flex-col">
            <ResizablePanelGroup direction="horizontal" className="h-full">
                <ResizablePanel defaultSize={15} minSize={10}>
                    <div className="h-full border-r border-gray-200 dark:border-neutral-800">
                        <TestingMenu projectId={projectId} app={app} />
                    </div>
                </ResizablePanel>
                
                <ResizableHandle />
                
                <ResizablePanel defaultSize={85}>
                    {app === "scenarios" && <ScenariosApp projectId={projectId} slug={slug.slice(1)} />}
                    {app === "simulations" && <SimulationsApp projectId={projectId} slug={slug.slice(1)} />}
                    {app === "profiles" && <ProfilesApp projectId={projectId} slug={slug.slice(1)} />}
                    {app === "runs" && <RunsApp projectId={projectId} slug={slug.slice(1)} />}
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}
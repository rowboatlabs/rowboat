'use client';

import { Tabs, Tab } from "@heroui/react";
import { ScheduledJobRulesList } from "../../scheduled-job-rules/components/scheduled-job-rules-list";
import { RecurringJobRulesList } from "./recurring-job-rules-list";

export function JobRulesTabs({ projectId }: { projectId: string }) {
    return (
        <div className="h-full flex flex-col">
            <div className="flex-1 overflow-hidden">
                <Tabs 
                    aria-label="Job Rules" 
                    className="h-full flex flex-col"
                    classNames={{
                        tabList: "flex-shrink-0",
                        panel: "flex-1 overflow-hidden",
                        tabContent: "text-sm font-medium",
                    }}
                >
                    <Tab key="scheduled" title="Scheduled Rules">
                        <ScheduledJobRulesList projectId={projectId} />
                    </Tab>
                    <Tab key="recurring" title="Recurring Rules">
                        <RecurringJobRulesList projectId={projectId} />
                    </Tab>
                </Tabs>
            </div>
        </div>
    );
}

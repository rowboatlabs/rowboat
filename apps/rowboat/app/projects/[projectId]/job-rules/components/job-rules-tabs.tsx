'use client';

import { useState } from "react";
import { Tabs, Tab } from "@/components/ui/tabs";
import { ScheduledJobRulesList } from "../scheduled/components/scheduled-job-rules-list";
import { RecurringJobRulesList } from "./recurring-job-rules-list";

export function JobRulesTabs({ projectId }: { projectId: string }) {
    const [activeTab, setActiveTab] = useState<string>("scheduled");

    const handleTabChange = (key: React.Key) => {
        setActiveTab(key.toString());
    };

    return (
        <div className="h-full flex flex-col">
            <Tabs
                selectedKey={activeTab}
                onSelectionChange={handleTabChange}
                aria-label="Job Rules"
                fullWidth
            >
                <Tab key="scheduled" title="Scheduled Rules">
                    <ScheduledJobRulesList projectId={projectId} />
                </Tab>
                <Tab key="recurring" title="Recurring Rules">
                    <RecurringJobRulesList projectId={projectId} />
                </Tab>
            </Tabs>
        </div>
    );
}

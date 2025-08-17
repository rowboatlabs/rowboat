'use client';
import { FormStatusButton } from "../../../../lib/components/form-status-button";
import { RefreshCwIcon } from "lucide-react";

export function Recrawl({
    handleRefresh,
}: {
    handleRefresh: () => void;
}) {
    return <form action={handleRefresh}>
        <FormStatusButton
            props={{
                type: "submit",
                startContent: <RefreshCwIcon />,
                children: "Refresh",
            }}
        />
    </form>;
}
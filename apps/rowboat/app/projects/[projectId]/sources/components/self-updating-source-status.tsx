'use client';
import { getDataSource } from "../../../../actions/data-source.actions";
import { DataSource } from "@/src/entities/models/data-source";
import { useEffect, useState } from "react";
import { z } from 'zod';
import { SourceStatus } from "./source-status";

export function SelfUpdatingSourceStatus({
    sourceId,
    initialStatus,
    compact = false,
}: {
    sourceId: string,
    initialStatus: z.infer<typeof DataSource>['status'],
    compact?: boolean;
}) {
    const [status, setStatus] = useState(initialStatus);

    useEffect(() => {
        let ignore = false;
        let timeoutId: NodeJS.Timeout | null = null;

        async function check() {
            if (ignore) {
                return;
            }
            const source = await getDataSource(sourceId);
            setStatus(source.status);
            timeoutId = setTimeout(check, 15 * 1000);
        }

        if (status == 'pending') {
            timeoutId = setTimeout(check, 15 * 1000);
        }

        return () => {
            ignore = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [status, sourceId]);

    return <SourceStatus status={status} compact={compact} />;
}
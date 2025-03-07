'use client';

import { deleteDataSource } from "@/app/actions";
import { FormStatusButton } from "@/app/lib/components/FormStatusButton";

export function DeleteSource({
    projectId,
    sourceId,
}: {
    projectId: string;
    sourceId: string;
}) {
    function handleDelete() {
        if (window.confirm('Are you sure you want to delete this data source?')) {
            deleteDataSource(projectId, sourceId);
        }
    }

    return <form action={handleDelete}>
        <FormStatusButton
            props={{
                type: "submit",
                children: "Delete data source",
                className: "text-red-800",
            }}
        />
    </form>;
}
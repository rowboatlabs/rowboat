import { WithStringId } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { useCallback, useEffect, useState } from "react";
import { listWorkflows } from "@/app/actions/workflow_actions";
import { Button, Pagination, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";
import { z } from "zod";
import { RelativeTime } from "@primer/react";
import { WorkflowIcon } from "../../../../../../lib/components/icons";
import { PublishedBadge } from "@/app/projects/[projectId]/workflow/published_badge";

interface WorkflowSelectorProps {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (workflow: WithStringId<z.infer<typeof Workflow>>) => void;
}

export function WorkflowSelector({ projectId, isOpen, onOpenChange, onSelect }: WorkflowSelectorProps) {
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [workflows, setWorkflows] = useState<WithStringId<z.infer<typeof Workflow>>[]>([]);
    const [totalPages, setTotalPages] = useState(0);
    const [publishedWorkflowId, setPublishedWorkflowId] = useState<string | null>(null);
    const pageSize = 10;

    const fetchWorkflows = useCallback(async (page: number) => {
        setLoading(true);
        setError(null);
        try {
            const result = await listWorkflows(projectId, page, pageSize);
            setWorkflows(result.workflows);
            setTotalPages(Math.ceil(result.total / pageSize));
            setPublishedWorkflowId(result.publishedWorkflowId);
        } catch (error) {
            setError(`Unable to fetch workflows: ${error}`);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (isOpen) {
            fetchWorkflows(page);
        }
    }, [page, isOpen, fetchWorkflows]);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl">
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader>Select a Workflow</ModalHeader>
                        <ModalBody>
                            {loading && <div className="flex gap-2 items-center">
                                <Spinner size="sm" />
                                Loading...
                            </div>}
                            {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
                                {error}
                                <Button size="sm" color="danger" onPress={() => fetchWorkflows(page)}>Retry</Button>
                            </div>}
                            {!loading && !error && <>
                                {workflows.length === 0 && <div className="text-gray-600 text-center">No workflows found</div>}
                                {workflows.length > 0 && <div className="flex flex-col gap-2">
                                    {workflows.map((workflow) => (
                                        <div 
                                            key={workflow._id} 
                                            className="flex items-center justify-between p-3 border rounded-md hover:bg-gray-50 cursor-pointer"
                                            onClick={() => {
                                                onSelect(workflow);
                                                onClose();
                                            }}
                                        >
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <WorkflowIcon />
                                                    <span className="font-medium">{workflow.name || 'Unnamed workflow'}</span>
                                                    {publishedWorkflowId === workflow._id && <PublishedBadge />}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Updated <RelativeTime date={new Date(workflow.lastUpdatedAt)} />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>}
                                {totalPages > 1 && <Pagination
                                    total={totalPages}
                                    page={page}
                                    onChange={setPage}
                                    className="self-center"
                                />}
                            </>}
                        </ModalBody>
                        <ModalFooter>
                            <Button size="sm" variant="flat" onPress={onClose}>
                                Cancel
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
} 
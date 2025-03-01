import { WithStringId } from "@/app/lib/types/types";
import { TestScenario } from "@/app/lib/types/testing_types";
import { useCallback, useEffect, useState } from "react";
import { listScenarios } from "@/app/actions/testing_actions";
import { Button, Pagination, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@nextui-org/react";
import { z } from "zod";

interface ScenarioSelectorProps {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (scenario: WithStringId<z.infer<typeof TestScenario>>) => void;
}

export function ScenarioSelector({ projectId, isOpen, onOpenChange, onSelect }: ScenarioSelectorProps) {
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [scenarios, setScenarios] = useState<WithStringId<z.infer<typeof TestScenario>>[]>([]);
    const [totalPages, setTotalPages] = useState(0);
    const pageSize = 10;

    const fetchScenarios = useCallback(async (page: number) => {
        setLoading(true);
        setError(null);
        try {
            const result = await listScenarios(projectId, page, pageSize);
            setScenarios(result.scenarios);
            setTotalPages(Math.ceil(result.total / pageSize));
        } catch (error) {
            setError(`Unable to fetch scenarios: ${error}`);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (isOpen) {
            fetchScenarios(page);
        }
    }, [page, isOpen, fetchScenarios]);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl">
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader>Select a Scenario</ModalHeader>
                        <ModalBody>
                            {loading && <div className="flex gap-2 items-center">
                                <Spinner size="sm" />
                                Loading...
                            </div>}
                            {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
                                {error}
                                <Button size="sm" color="danger" onClick={() => fetchScenarios(page)}>Retry</Button>
                            </div>}
                            {!loading && !error && <>
                                {scenarios.length === 0 && <div className="text-gray-600 text-center">No scenarios found</div>}
                                {scenarios.length > 0 && <div className="flex flex-col w-full">
                                    <div className="grid grid-cols-5 py-2 bg-gray-100 font-semibold text-sm">
                                        <div className="col-span-2 px-4">Name</div>
                                        <div className="col-span-3 px-4">Description</div>
                                    </div>

                                    {scenarios.map((s) => (
                                        <div 
                                            key={s._id} 
                                            className="grid grid-cols-5 py-2 border-b hover:bg-gray-50 text-sm cursor-pointer"
                                            onClick={() => {
                                                onSelect(s);
                                                onClose();
                                            }}
                                        >
                                            <div className="col-span-2 px-4 truncate">{s.name}</div>
                                            <div className="col-span-3 px-4 truncate">{s.description}</div>
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
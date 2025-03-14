import { WithStringId } from "@/app/lib/types/types";
import { TestSimulation } from "@/app/lib/types/testing_types";
import { useCallback, useEffect, useState } from "react";
import { listSimulations } from "@/app/actions/testing_actions";
import { Button, Pagination, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Chip } from "@heroui/react";
import { z } from "zod";
import { RelativeTime } from "@primer/react";

interface SimulationSelectorProps {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (simulations: WithStringId<z.infer<typeof TestSimulation>>[]) => void;
    initialSelected?: WithStringId<z.infer<typeof TestSimulation>>[];
}

export function SimulationSelector({ projectId, isOpen, onOpenChange, onSelect, initialSelected = [] }: SimulationSelectorProps) {
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [simulations, setSimulations] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>([]);
    const [totalPages, setTotalPages] = useState(0);
    const [selectedSimulations, setSelectedSimulations] = useState<WithStringId<z.infer<typeof TestSimulation>>[]>(initialSelected);
    const pageSize = 3;

    const fetchSimulations = useCallback(async (page: number) => {
        setLoading(true);
        setError(null);
        try {
            const result = await listSimulations(projectId, page, pageSize);
            setSimulations(result.simulations);
            setTotalPages(Math.ceil(result.total / pageSize));
        } catch (error) {
            setError(`Unable to fetch simulations: ${error}`);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (isOpen) {
            fetchSimulations(page);
        }
    }, [page, isOpen, fetchSimulations]);

    const handleSelect = (simulation: WithStringId<z.infer<typeof TestSimulation>>) => {
        const isSelected = selectedSimulations.some(s => s._id === simulation._id);
        let newSelected;
        if (isSelected) {
            newSelected = selectedSimulations.filter(s => s._id !== simulation._id);
        } else {
            newSelected = [...selectedSimulations, simulation];
        }
        setSelectedSimulations(newSelected);
        onSelect(newSelected);
    };

    const handleRemove = (simulationId: string) => {
        const newSelected = selectedSimulations.filter(s => s._id !== simulationId);
        setSelectedSimulations(newSelected);
        onSelect(newSelected);
    };

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl">
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader>Select Simulations</ModalHeader>
                        <ModalBody>
                            {selectedSimulations.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {selectedSimulations.map((sim) => (
                                        <Chip
                                            key={sim._id}
                                            onClose={() => handleRemove(sim._id)}
                                            variant="flat"
                                            className="py-1"
                                        >
                                            {sim.name}
                                        </Chip>
                                    ))}
                                </div>
                            )}

                            {loading && <div className="flex gap-2 items-center">
                                <Spinner size="sm" />
                                Loading...
                            </div>}
                            {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
                                {error}
                                <Button size="sm" color="danger" onPress={() => fetchSimulations(page)}>Retry</Button>
                            </div>}
                            {!loading && !error && <>
                                {simulations.length === 0 && <div className="text-gray-600 text-center">No simulations found</div>}
                                {simulations.length > 0 && <div className="flex flex-col w-full">
                                    <div className="grid grid-cols-8 py-2 bg-gray-100 font-semibold text-sm">
                                        <div className="col-span-3 px-4">Name</div>
                                        <div className="col-span-3 px-4">Pass Criteria</div>
                                        <div className="col-span-2 px-4">Last Updated</div>
                                    </div>

                                    {simulations.map((sim) => {
                                        const isSelected = selectedSimulations.some(s => s._id === sim._id);
                                        return (
                                            <div 
                                                key={sim._id} 
                                                className={`grid grid-cols-8 py-2 border-b hover:bg-gray-50 text-sm cursor-pointer ${
                                                    isSelected ? 'bg-blue-50 hover:bg-blue-100' : ''
                                                }`}
                                                onClick={() => handleSelect(sim)}
                                            >
                                                <div className="col-span-3 px-4 truncate">{sim.name}</div>
                                                <div className="col-span-3 px-4 truncate">{sim.passCriteria || '-'}</div>
                                                <div className="col-span-2 px-4 truncate">
                                                    <RelativeTime date={new Date(sim.lastUpdatedAt)} />
                                                </div>
                                            </div>
                                        );
                                    })}
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
                                Done
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
} 
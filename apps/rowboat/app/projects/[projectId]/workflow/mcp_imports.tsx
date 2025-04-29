"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Checkbox } from "@heroui/react";
import { z } from "zod";
import { WorkflowTool } from "@/app/lib/types/workflow_types";
import { RefreshCwIcon } from "lucide-react";
import { fetchMcpTools } from "@/app/actions/mcp_actions";

interface McpImportToolsProps {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onImport: (tools: z.infer<typeof WorkflowTool>[]) => void;
}

export function McpImportTools({ projectId, isOpen, onOpenChange, onImport }: McpImportToolsProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tools, setTools] = useState<z.infer<typeof WorkflowTool>[]>([]);
    const [selectedTools, setSelectedTools] = useState<Set<number>>(new Set());

    const process = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSelectedTools(new Set());
        try {
            const result = await fetchMcpTools(projectId);
            setTools(result);
            // Select all tools by default
            setSelectedTools(new Set(result.map((_, index) => index)));
        } catch (error) {
            setError(`Не удалось загрузить инструменты: ${error}`);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        console.log("mcp import tools useEffect", isOpen);
        if (isOpen) {
            process();
        }
    }, [isOpen, process]);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl">
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader>Импорт инструментов</ModalHeader>
                        <ModalBody>
                            {loading && <div className="flex gap-2 items-center">
                                <Spinner size="sm" />
                                Загрузка...
                            </div>}
                            {error && <div className="bg-red-100 p-2 rounded-md text-red-800 flex items-center gap-2 text-sm">
                                {error}
                                <Button size="sm" color="danger" onPress={() => process()}>Ещё раз</Button>
                            </div>}
                            {!loading && !error && <>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="text-gray-600">
                                        {tools.length === 0 ? "Нет инструментов" : `Нашли ${tools.length} инструментов:`}
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="flat"
                                        onPress={() => {
                                            setTools([]);
                                            process();
                                        }}
                                        startContent={<RefreshCwIcon className="w-4 h-4" />}
                                    >
                                        Обновить список
                                    </Button>
                                </div>
                                {tools.length > 0 && <div className="flex flex-col w-full mt-4">
                                    <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 rounded-t-lg border-b text-sm text-gray-700 font-medium">
                                        <div className="w-8">
                                            <Checkbox
                                                size="sm"
                                                isSelected={selectedTools.size === tools.length}
                                                isIndeterminate={selectedTools.size > 0 && selectedTools.size < tools.length}
                                                onValueChange={(checked) => {
                                                    if (checked) {
                                                        setSelectedTools(new Set(tools.map((_, i) => i)));
                                                    } else {
                                                        setSelectedTools(new Set());
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div className="w-36">Сервер</div>
                                        <div className="flex-1">Название инструмента</div>
                                    </div>
                                    <div className="border rounded-b-lg divide-y overflow-y-auto max-h-[300px]">
                                        {tools.map((t, index) => (
                                            <div 
                                                key={index} 
                                                className="flex items-center gap-4 px-4 py-2 hover:bg-gray-50 transition-colors"
                                            >
                                                <div className="w-8">
                                                    <Checkbox
                                                        size="sm"
                                                        isSelected={selectedTools.has(index)}
                                                        onValueChange={(checked) => {
                                                            const newSelected = new Set(selectedTools);
                                                            if (checked) {
                                                                newSelected.add(index);
                                                            } else {
                                                                newSelected.delete(index);
                                                            }
                                                            setSelectedTools(newSelected);
                                                        }}
                                                    />
                                                </div>
                                                <div className="w-36">
                                                    <div className="bg-blue-50 px-2 py-1 rounded text-blue-700 text-sm font-medium border border-blue-100">
                                                        {t.mcpServerName}
                                                    </div>
                                                </div>
                                                <div className="flex-1 truncate text-gray-700">{t.name}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>}
                                {tools.length > 0 && (
                                    <div className="mt-4 text-sm text-gray-600">
                                        Выбрано: {selectedTools.size} из {tools.length}
                                    </div>
                                )}
                            </>}
                        </ModalBody>
                        <ModalFooter>
                            <Button size="sm" variant="flat" onPress={onClose}>
                                Отмена
                            </Button>
                            {tools.length > 0 && <Button size="sm" onPress={() => {
                                const selectedToolsList = tools.filter((_, index) => selectedTools.has(index));
                                onImport(selectedToolsList);
                                onClose();
                            }}>
                                Импортировать
                            </Button>}
                         </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
} 
import { Table, TableHeader, TableBody, TableColumn, TableRow, TableCell, Selection } from "@heroui/react";
import { Button } from "@heroui/react";
import { PencilIcon, TrashIcon, EyeIcon, DownloadIcon } from "lucide-react";
import Link from "next/link";
import { ReactNode, useState } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/react";

// Helper function to safely parse dates
const isValidDate = (date: any): boolean => {
    const parsed = new Date(date);
    return parsed instanceof Date && !isNaN(parsed.getTime());
};

interface Column {
    key: string;
    label: string;
    render?: (item: any) => ReactNode;
}

interface DataTableProps {
    items: any[];
    columns: Column[];
    selectedKeys?: Selection;
    onSelectionChange?: (keys: Selection) => void;
    projectId: string;
    onDelete?: (id: string) => Promise<void>;
    onEdit?: (id: string) => void;
    onView?: (id: string) => void;
    onDownload?: (id: string) => void;
    selectionMode?: "multiple" | "none";
}

export function DataTable({
    items,
    columns,
    selectedKeys,
    onSelectionChange,
    projectId,
    onDelete,
    onEdit,
    onView,
    onDownload,
    selectionMode = "multiple",
}: DataTableProps) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<string | null>(null);
    const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const handleDeleteClick = (id: string) => {
        setItemToDelete(id);
        setIsDeleteModalOpen(true);
    };

    const handleDeleteConfirm = async () => {
        if (!itemToDelete || !onDelete) return;
        
        try {
            await onDelete(itemToDelete);
            setIsDeleteModalOpen(false);
            setItemToDelete(null);
        } catch (error) {
            setDeleteError(`Failed to delete: ${error}`);
        }
    };

    const handleDeleteAll = async () => {
        if (!onDelete) return;

        try {
            // Delete all items sequentially
            for (const item of items) {
                await onDelete(item._id);
            }
            setIsDeleteAllModalOpen(false);
            // Selection will be cleared automatically when items refresh
        } catch (error) {
            setDeleteError(`Failed to delete items: ${error}`);
        }
    };

    const isAllSelected = selectedKeys === "all";

    const renderCells = (item: any) => {
        const cells = columns.map(column => (
            <TableCell key={column.key}>
                {column.render ? column.render(item) : 
                    // Handle date fields specially
                    (column.key.toLowerCase().includes('date') || 
                     column.key === 'createdAt' || 
                     column.key === 'lastUpdatedAt') && isValidDate(item[column.key]) ?
                        new Date(item[column.key]).toLocaleString() :
                        item[column.key]
                }
            </TableCell>
        ));

        // Only add actions column if there are any actions
        const hasActions = onDelete || onEdit || onView || onDownload;
        if (hasActions) {
            cells.push(
                <TableCell key="actions">
                    <div className="flex items-center gap-0.5">
                        {onView && (
                            <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                onPress={() => onView(item._id)}
                                aria-label="View item"
                            >
                                <EyeIcon size={16} />
                            </Button>
                        )}
                        {onEdit && (
                            <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                onPress={() => onEdit(item._id)}
                                aria-label="Edit item"
                            >
                                <PencilIcon size={16} />
                            </Button>
                        )}
                        {onDownload && (
                            <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                onPress={() => onDownload(item._id)}
                                aria-label="Download results"
                            >
                                <DownloadIcon size={16} />
                            </Button>
                        )}
                        {onDelete && (
                            <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                color="danger"
                                onPress={() => handleDeleteClick(item._id)}
                                aria-label="Delete item"
                            >
                                <TrashIcon size={16} />
                            </Button>
                        )}
                    </div>
                </TableCell>
            );
        }

        return cells;
    };

    return (
        <>
            <div className="flex flex-col gap-4">
                {/* Only show Delete All button when selection is enabled and items are selected */}
                {selectionMode === "multiple" && selectedKeys === "all" && items.length > 0 && (
                    <div className="flex justify-start">
                        <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            onPress={() => setIsDeleteAllModalOpen(true)}
                            startContent={<TrashIcon size={16} />}
                        >
                            Delete All ({items.length})
                        </Button>
                    </div>
                )}

                <Table
                    selectedKeys={selectionMode === "multiple" ? selectedKeys : undefined}
                    onSelectionChange={selectionMode === "multiple" ? onSelectionChange : undefined}
                    aria-label="Data table"
                    classNames={{
                        base: "max-h-[400px] overflow-auto",
                        table: "min-w-full",
                    }}
                    selectionMode={selectionMode}
                >
                    <TableHeader columns={[
                        ...columns.map(column => ({
                            key: column.key,
                            label: column.label
                        })),
                        ...((onDelete || onEdit || onView || onDownload) ? [{
                            key: 'actions',
                            label: 'ACTIONS',
                            render: (item: any) => (
                                <div className="flex items-center gap-0.5">
                                    <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                    >
                                        <PencilIcon size={16} />
                                    </Button>
                                    <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        color="danger"
                                    >
                                        <TrashIcon size={16} />
                                    </Button>
                                </div>
                            ),
                        }] : [])
                    ]}>
                        {(column) => (
                            <TableColumn key={column.key}>{column.label}</TableColumn>
                        )}
                    </TableHeader>
                    <TableBody items={items}>
                        {(item) => (
                            <TableRow key={item._id}>
                                {renderCells(item)}
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Single Delete Confirmation Modal */}
            <Modal
                isOpen={isDeleteModalOpen}
                onOpenChange={(open) => {
                    setIsDeleteModalOpen(open);
                    if (!open) setItemToDelete(null);
                }}
                size="sm"
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>Confirm Deletion</ModalHeader>
                            <ModalBody>
                                Are you sure you want to delete this item?
                            </ModalBody>
                            <ModalFooter>
                                <Button size="sm" variant="flat" onPress={onClose}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    color="danger"
                                    onPress={() => {
                                        handleDeleteConfirm();
                                        onClose();
                                    }}
                                >
                                    Delete
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            {/* Delete All Confirmation Modal */}
            <Modal
                isOpen={isDeleteAllModalOpen}
                onOpenChange={setIsDeleteAllModalOpen}
                size="sm"
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>Confirm Delete All</ModalHeader>
                            <ModalBody>
                                Are you sure you want to delete all {items.length} items? This action cannot be undone.
                            </ModalBody>
                            <ModalFooter>
                                <Button size="sm" variant="flat" onPress={onClose}>
                                    Cancel
                                </Button>
                                <Button
                                    size="sm"
                                    color="danger"
                                    onPress={() => {
                                        handleDeleteAll();
                                        onClose();
                                    }}
                                >
                                    Delete All
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>

            {/* Error Modal */}
            <Modal
                isOpen={deleteError !== null}
                onOpenChange={() => setDeleteError(null)}
                size="sm"
            >
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>Error</ModalHeader>
                            <ModalBody>
                                {deleteError}
                            </ModalBody>
                            <ModalFooter>
                                <Button size="sm" onPress={onClose}>
                                    Close
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </>
    );
}
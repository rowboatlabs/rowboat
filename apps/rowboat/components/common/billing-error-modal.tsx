import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

interface BillingErrorModalProps {
    isOpen: boolean;
    onClose: () => void;
    errorMessage: string;
}

export function BillingErrorModal({ isOpen, onClose, errorMessage }: BillingErrorModalProps) {
    const router = useRouter();

    const handleManage = () => {
        router.push('/billing');
        onClose();
    };

    return (
        <Modal 
            isOpen={isOpen} 
            onOpenChange={onClose}
            size="md"
            classNames={{
                base: "bg-white dark:bg-gray-900",
                header: "border-b border-gray-200 dark:border-gray-800",
                footer: "border-t border-gray-200 dark:border-gray-800",
            }}
        >
            <ModalContent>
                <ModalHeader className="flex gap-2 items-center">
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    <span>Billing Error</span>
                </ModalHeader>
                <ModalBody>
                    <div className="space-y-2">
                        <p className="text-gray-900 dark:text-gray-100">
                            {errorMessage}
                        </p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            You can view your current usage and upgrade your plan to continue.
                        </p>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <div className="flex gap-2 justify-end">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                        >
                            Dismiss
                        </Button>
                        <Button
                            variant="solid"
                            onPress={handleManage}
                        >
                            View usage / upgrade
                        </Button>
                    </div>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
} 
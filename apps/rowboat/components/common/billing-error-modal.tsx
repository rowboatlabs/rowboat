import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from "@heroui/react";
import { AlertCircle, TruckIcon } from "lucide-react";
import { getUpgradePricingTableSession } from "@/app/actions/billing_actions";
import { useEffect, useState } from "react";
import { PricingTableResponse } from "@/app/lib/types/billing_types";
import { z } from "zod";
import Link from "next/link";

// Add TypeScript support for stripe-pricing-table element
declare global {
    namespace JSX {
        interface IntrinsicElements {
            'stripe-pricing-table': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
        }
    }
}

interface BillingErrorModalProps {
    isOpen: boolean;
    onClose: () => void;
    errorMessage: string;
}

export function BillingErrorModal({ isOpen, onClose, errorMessage }: BillingErrorModalProps) {
    const [pricingTableData, setPricingTableData] = useState<z.infer<typeof PricingTableResponse> | null>(null);
    const [loadingPricingTableSession, setLoadingPricingTableSession] = useState(false);

    useEffect(() => {
        let ignore = false;

        async function loadPricingTable() {
            try {
                setLoadingPricingTableSession(true);
                const response = await getUpgradePricingTableSession();
                if (ignore) {
                    return;
                }
                setPricingTableData(response);
                setLoadingPricingTableSession(false);
            } catch (error) {
                console.error('Failed to load pricing table:', error);
            }
        }

        if (isOpen) {
            loadPricingTable();
        }

        return () => {
            ignore = true;
        }
    }, [isOpen]);

    return (
        <Modal 
            isOpen={isOpen} 
            onOpenChange={onClose}
            size="4xl"
            classNames={{
                base: "bg-white dark:bg-gray-900",
                header: "border-b border-gray-200 dark:border-gray-800",
                footer: "border-t border-gray-200 dark:border-gray-800",
            }}
        >
            <ModalContent>
                <ModalHeader className="flex gap-2 items-center">
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    <span>Upgrade to do more with Rowboat</span>
                </ModalHeader>
                <ModalBody>
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <p className="text-gray-900 dark:text-gray-100">
                                {errorMessage}
                            </p>
                        </div>
                        
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                Choose a plan
                            </h3>
                            
                            {loadingPricingTableSession && <Spinner size="sm" />}
                            {pricingTableData && (
                                <div className="w-full">
                                    <stripe-pricing-table
                                        pricing-table-id={pricingTableData.pricingTableId}
                                        publishable-key={pricingTableData.publishableKey}
                                        customer-session-client-secret={pricingTableData.clientSecret}
                                    >
                                    </stripe-pricing-table>
                                </div>
                            )}
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Link 
                        href="/billing"
                        className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                    >
                        View usage
                    </Link>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
} 
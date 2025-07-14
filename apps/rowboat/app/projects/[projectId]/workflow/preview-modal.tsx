import { createContext, useContext, useEffect, useState } from "react";
import clsx from "clsx";
import MarkdownContent from "../../../lib/components/markdown-content";
import React, { PureComponent } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { XIcon, EyeIcon } from "lucide-react";
import { Button } from "@heroui/react";

// Create the context type
export type PreviewModalContextType = {
    showPreview: (
        oldValue: string | undefined,
        newValue: string,
        markdown: boolean,
        title: string,
        message?: string,
        onApply?: () => void
    ) => void;
};

// Create the context
export const PreviewModalContext = createContext<PreviewModalContextType>({
    showPreview: () => { }
});

// Export the hook for easy usage
export const usePreviewModal = () => useContext(PreviewModalContext);

// Create the provider component
export function PreviewModalProvider({ children }: { children: React.ReactNode }) {
    const [modalProps, setModalProps] = useState<{
        oldValue?: string;
        newValue: string;
        markdown: boolean;
        title: string;
        message?: string;
        onApply?: () => void;
        isOpen: boolean;
    }>({
        newValue: '',
        markdown: false,
        title: '',
        isOpen: false
    });

    // Handle Esc key
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setModalProps(prev => ({ ...prev, isOpen: false }));
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    // Update the showPreview function
    const showPreview = (
        oldValue: string | undefined,
        newValue: string,
        markdown: boolean,
        title: string,
        message?: string,
        onApply?: () => void
    ) => {
        setModalProps({ oldValue, newValue, markdown, title, message, onApply, isOpen: true });
    };

    return (
        <PreviewModalContext.Provider value={{ showPreview }}>
            {children}
            {modalProps.isOpen && (
                <PreviewModal
                    {...modalProps}
                    onClose={() => setModalProps(prev => ({ ...prev, isOpen: false }))}
                />
            )}
        </PreviewModalContext.Provider>
    );
}

// The modal component
function PreviewModal({
    oldValue = undefined,
    newValue,
    markdown = false,
    title,
    message,
    onApply,
    onClose,
}: {
    oldValue?: string | undefined;
    newValue: string;
    markdown?: boolean;
    title: string;
    message?: string;
    onApply?: () => void;
    onClose: () => void;
}) {
    const buttonLabel = oldValue === undefined ? 'Preview' : 'Diff';
    const [view, setView] = useState<'preview' | 'markdown'>('preview');

    return (
        <div className="fixed left-0 top-0 w-full h-full bg-gray-500/50 backdrop-blur-sm flex justify-center items-center z-50">
            <div className="relative bg-gradient-to-br from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-800 rounded-lg shadow-2xl p-6 w-[98vw] max-w-7xl max-h-[90vh] flex flex-col gap-6">
                {/* Close button */}
                <button className="absolute top-4 right-4 rounded-full p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors" onClick={onClose}>
                    <XIcon className="w-5 h-5 text-zinc-500" />
                </button>
                {/* Header */}
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <EyeIcon className="text-indigo-500 w-5 h-5" />
                        <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{title}</span>
                    </div>
                    {message && <div className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">{message}</div>}
                    <div className="border-b border-zinc-100 dark:border-zinc-800 mb-4" />
                </div>
                {/* Tabs */}
                <div className="flex gap-2 mb-2">
                    <button
                        className={clsx(
                            "px-4 py-1 rounded-full text-sm font-medium transition-colors",
                            view === 'preview'
                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 shadow'
                                : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                        )}
                        onClick={() => setView('preview')}
                    >
                        {buttonLabel}
                    </button>
                    {markdown && (
                        <button
                            className={clsx(
                                "px-4 py-1 rounded-full text-sm font-medium transition-colors",
                                view === 'markdown'
                                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200 shadow'
                                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                            )}
                            onClick={() => setView('markdown')}
                        >
                            Markdown
                        </button>
                    )}
                </div>
                {/* Diff/Markdown content */}
                <div className="bg-white dark:bg-zinc-900 rounded-md grow overflow-auto border border-zinc-100 dark:border-zinc-800">
                    <div className="h-full flex flex-col overflow-auto">
                        {view === 'preview' && <div className="flex gap-1 overflow-auto text-sm">
                            {oldValue !== undefined && <ReactDiffViewer
                                oldValue={oldValue}
                                newValue={newValue}
                                splitView={true}
                                compareMethod={DiffMethod.WORDS_WITH_SPACE}
                            />}
                            {oldValue === undefined && <pre className="p-2 overflow-auto">{newValue}</pre>}
                        </div>}
                        {view === 'markdown' && <div className="flex gap-1">
                            {oldValue !== undefined && <div className="w-1/2 flex flex-col border-r-2 border-gray-200 dark:border-zinc-800 overflow-auto">
                                <div className="text-gray-800 dark:text-gray-200 font-semibold italic text-sm px-2 py-1 border-b border-gray-200 dark:border-zinc-800">Old</div>
                                <div className="p-2 overflow-auto">
                                    <MarkdownContent
                                        content={oldValue}
                                    />
                                </div>
                            </div>}
                            <div className={clsx("flex flex-col", {
                                'w-1/2': oldValue !== undefined
                            })}>
                                {oldValue !== undefined && <div className="text-gray-800 dark:text-gray-200 font-semibold italic text-sm px-2 py-1 border-b border-gray-200 dark:border-zinc-800">New</div>}
                                <div className="p-2 overflow-auto">
                                    <MarkdownContent
                                        content={newValue}
                                    />
                                </div>
                            </div>
                        </div>}
                    </div>
                </div>
                {/* Footer */}
                {onApply && (
                    <div className="flex justify-end pt-2 border-t border-zinc-100 dark:border-zinc-800 sticky bottom-0 bg-gradient-to-t from-white/90 to-transparent dark:from-zinc-900/90">
                        <Button
                            variant="solid"
                            color="primary"
                            onPress={() => {
                                onApply();
                                onClose();
                            }}
                            className="rounded-full px-6 py-2 shadow"
                        >
                            Apply changes
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
} 
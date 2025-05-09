import { useFloating, offset, flip, shift, arrow, FloatingArrow, FloatingPortal, autoUpdate } from '@floating-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';

interface TourStep {
    target: string;
    content: string;
    title: string;
}

const TOUR_STEPS: TourStep[] = [
    {
        target: 'copilot',
        content: 'Build agents with the help of copilot.\nThis might take a minute.',
        title: 'Step 1/9'
    },
    {
        target: 'playground',
        content: 'Test your assistant in the playground.\nDebug tool calls and responses.',
        title: 'Step 2/9'
    },
    {
        target: 'entity-agents',
        content: 'Manage your agents.\nSpecify instructions, examples and tool usage.',
        title: 'Step 3/9'
    },
    {
        target: 'entity-tools',
        content: 'Create your own tools, import MCP tools or use existing ones.\nMock tools for quick testing.',
        title: 'Step 4/9'
    },
    {
        target: 'entity-prompts',
        content: 'Manage prompts which will be used by agents.\nConfigure greeting message.',
        title: 'Step 5/9'
    },
    {
        target: 'entity-data-sources',
        content: 'Add and manage RAG data sources which will be used by agents.\nAvailable sources are local files, S3 files, web URLs and plain text.  \n\nIMPORTANT: Once you have added a data source, make sure to add it inside your\nagent configuration and agent instructions (mention the @tool:rag_search).',
        title: 'Step 6/9'
    },
    {
        target: 'settings',
        content: 'Configure project settings\nGet API keys, configure tool webhooks.',
        title: 'Step 7/9'
    },
    {
        target: 'deploy',
        content: 'Deploy your workflow version to make it live.\nThis will make your workflow available for use via the API and SDK.\n\nLearn more:\n• <a href="https://docs.rowboatlabs.com/using_the_api/" target="_blank" class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">Using the API</a>\n• <a href="https://docs.rowboatlabs.com/using_the_sdk/" target="_blank" class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">Using the SDK</a>',
        title: 'Step 8/9'
    },
    {
        target: 'tour-button',
        content: 'Come back here anytime to restart the tour.\nStill have questions? See our <a href="https://docs.rowboatlabs.com/" target="_blank" class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">docs</a> or reach out on <a href="https://discord.gg/gtbGcqF4" target="_blank" class="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">discord</a>.',
        title: 'Step 9/9'
    }
];

function TourBackdrop({ targetElement }: { targetElement: Element | null }) {
    const [rect, setRect] = useState<DOMRect | null>(null);
    const isPanelTarget = targetElement?.getAttribute('data-tour-target') && 
        ['entity-agents', 'entity-tools', 'entity-prompts', 'copilot', 'playground'].includes(
            targetElement.getAttribute('data-tour-target')!
        );
    
    // Use smaller padding for panels to prevent overlap
    const padding = isPanelTarget ? 12 : 8;

    useEffect(() => {
        if (targetElement) {
            const updateRect = () => {
                const newRect = targetElement.getBoundingClientRect();
                setRect(newRect);
            };

            updateRect();
            window.addEventListener('resize', updateRect);
            window.addEventListener('scroll', updateRect);

            return () => {
                window.removeEventListener('resize', updateRect);
                window.removeEventListener('scroll', updateRect);
            };
        }
    }, [targetElement]);

    if (!rect) return null;

    return (
        <>
            {/* Top */}
            <div className="fixed z-[100] backdrop-blur-sm bg-black/30" style={{ 
                top: 0, 
                left: 0, 
                right: 0, 
                height: Math.max(0, rect.top - padding)
            }} />
            
            {/* Left */}
            <div className="fixed z-[100] backdrop-blur-sm bg-black/30" style={{ 
                top: Math.max(0, rect.top - padding),
                left: 0,
                width: Math.max(0, rect.left - padding),
                height: rect.height + padding * 2
            }} />
            
            {/* Right */}
            <div className="fixed z-[100] backdrop-blur-sm bg-black/30" style={{ 
                top: Math.max(0, rect.top - padding),
                left: rect.right + padding,
                right: 0,
                height: rect.height + padding * 2
            }} />
            
            {/* Bottom */}
            <div className="fixed z-[100] backdrop-blur-sm bg-black/30" style={{ 
                top: rect.bottom + padding,
                left: 0,
                right: 0,
                bottom: 0
            }} />

            {/* Highlight border around target */}
            <div
                className="fixed z-[100] border-2 border-white/50 rounded-lg pointer-events-none"
                style={{
                    top: rect.top - padding,
                    left: rect.left - padding,
                    width: rect.width + padding * 2,
                    height: rect.height + padding * 2,
                }}
            />
        </>
    );
}

export function ProductTour({
    projectId,
    onComplete
}: {
    projectId: string;
    onComplete: () => void;
}) {
    const [currentStep, setCurrentStep] = useState(0);
    const [shouldShow, setShouldShow] = useState(true);
    const arrowRef = useRef(null);

    // Check if tour has been completed by the user
    useEffect(() => {
        const tourCompleted = localStorage.getItem('user_product_tour_completed');
        if (tourCompleted) {
            setShouldShow(false);
        }
    }, []);

    const currentTarget = TOUR_STEPS[currentStep].target;
    const targetElement = document.querySelector(`[data-tour-target="${currentTarget}"]`);

    // Determine if the target is a panel that should have the hint on the side
    const isPanelTarget = ['entity-agents', 'entity-tools', 'entity-prompts', 'copilot', 'playground'].includes(currentTarget);

    const { x, y, strategy, refs, context, middlewareData } = useFloating({
        placement: isPanelTarget ? 'right' : 'top',
        middleware: [
            offset(16),
            flip({
                fallbackPlacements: isPanelTarget ? ['left', 'top', 'bottom'] : ['bottom', 'left', 'right'],
                padding: 16
            }),
            shift({
                padding: 16,
                crossAxis: true,
                mainAxis: true
            }),
            arrow({ element: arrowRef })
        ],
        whileElementsMounted: autoUpdate
    });

    // Update reference element when step changes
    useEffect(() => {
        if (targetElement) {
            refs.setReference(targetElement);
        }
    }, [currentStep, targetElement, refs]);

    const handleNext = useCallback(() => {
        if (currentStep < TOUR_STEPS.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            // Mark tour as completed for the user
            localStorage.setItem('user_product_tour_completed', 'true');
            // Clean up any old project-specific tour flags
            localStorage.removeItem(`project_tour_${projectId}`);
            setShouldShow(false);
            onComplete();
        }
    }, [currentStep, projectId, onComplete]);

    const handleSkip = useCallback(() => {
        // Mark tour as completed for the user
        localStorage.setItem('user_product_tour_completed', 'true');
        // Clean up any old project-specific tour flags
        localStorage.removeItem(`project_tour_${projectId}`);
        setShouldShow(false);
        onComplete();
    }, [projectId, onComplete]);

    if (!shouldShow) return null;

    // Get the actual placement after middleware calculations
    const actualPlacement = middlewareData.flip?.overflows?.length ? 
        middlewareData.flip?.overflows[0].placement : 
        isPanelTarget ? 'right' : 'top';

    return (
        <FloatingPortal>
            <TourBackdrop targetElement={targetElement} />
            <div
                ref={refs.setFloating}
                style={{
                    position: strategy,
                    top: y ?? 0,
                    left: x ?? 0,
                    width: 'max-content',
                    maxWidth: '90vw',
                    zIndex: 101,
                }}
                className="bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 p-4 animate-in fade-in duration-200"
            >
                <button
                    onClick={handleSkip}
                    className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                    <XIcon size={16} />
                </button>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    {TOUR_STEPS[currentStep].title}
                </div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 whitespace-pre-line [&>a]:underline"
                    dangerouslySetInnerHTML={{ __html: TOUR_STEPS[currentStep].content }}
                />
                <div className="flex justify-between items-center">
                    <button
                        onClick={handleSkip}
                        className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                        Skip tour
                    </button>
                    <button
                        onClick={handleNext}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
                    >
                        {currentStep === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}
                    </button>
                </div>
                <FloatingArrow
                    ref={arrowRef}
                    context={context}
                    fill="white"
                    className="dark:fill-zinc-800"
                />
            </div>
        </FloatingPortal>
    );
} 
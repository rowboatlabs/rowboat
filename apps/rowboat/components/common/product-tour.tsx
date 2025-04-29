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
        content: 'Создавайте агентов с помощью ассистента.\nЭто может занять минуту.',
        title: 'Шаг 1/6'
    },
    {
        target: 'playground',
        content: 'Тестируйте вашего агента в песочнице.\nОтлаживайте вызовы инструментов и ответы.',
        title: 'Шаг 2/6'
    },
    {
        target: 'entity-agents',
        content: 'Управляйте вашими агентами.\nУказывайте инструкции, примеры и использование инструментов.',
        title: 'Шаг 3/6'
    },
    {
        target: 'entity-tools',
        content: 'Создавайте свои инструменты, импортируйте инструменты MCP или используйте существующие.\nМакеты инструментов для быстрого тестирования.',
        title: 'Шаг 4/6'
    },
    {
        target: 'entity-prompts',
        content: 'Управляйте подсказками, которые будут использоваться агентами.\nНастраивайте приветственное сообщение.',
        title: 'Шаг 5/6'
    },
    {
        target: 'settings',
        content: 'Настройте параметры проекта\nПолучите API-ключи, настройте вебхуки инструментов.',
        title: 'Шаг 6/6'
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
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 whitespace-pre-line">
                    {TOUR_STEPS[currentStep].content}
                </div>
                <div className="flex justify-between items-center">
                    <button
                        onClick={handleSkip}
                        className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                        Пропустить обучение
                    </button>
                    <button
                        onClick={handleNext}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
                    >
                        {currentStep === TOUR_STEPS.length - 1 ? 'Завершить' : 'Далее'}
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
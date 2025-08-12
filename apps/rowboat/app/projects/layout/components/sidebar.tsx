'use client';
import { useEffect, useState } from 'react';
import Link from "next/link";
import Image from "next/image";
import logoImage from '@/public/logo-only.png';
import { usePathname } from "next/navigation";
import { Tooltip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
import { UserButton } from "@/app/lib/components/user_button";
import { 
  SettingsIcon, 
  WorkflowIcon, 
  PlayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Moon,
  Sun,
  HelpCircle,
  MessageSquareIcon,
  LogsIcon,
  Clock
} from "lucide-react";
import { getProjectConfig } from "@/app/actions/project_actions";
import { createProjectWithOptions } from "../../lib/project-creation-utils";
import { useTheme } from "@/app/providers/theme-provider";
import { USE_PRODUCT_TOUR } from '@/app/lib/feature_flags';
import { useHelpModal } from "@/app/providers/help-modal-provider";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextareaWithSend } from "@/app/components/ui/textarea-with-send";

interface SidebarProps {
  projectId?: string;
  useAuth: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  useBilling?: boolean;
}

const EXPANDED_ICON_SIZE = 20;
const COLLAPSED_ICON_SIZE = 20; // DO NOT CHANGE THIS

export default function Sidebar({ projectId, useAuth, collapsed = false, onToggleCollapse, useBilling }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [projectName, setProjectName] = useState<string>("Select Project");
  const [assistantName, setAssistantName] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [isCreatingAssistant, setIsCreatingAssistant] = useState(false);
  const isProjectsRoute = pathname === '/projects';
  const { theme, toggleTheme } = useTheme();
  const { showHelpModal } = useHelpModal();
  const { isOpen: isCreateModalOpen, onOpen: onCreateModalOpen, onClose: onCreateModalClose } = useDisclosure();

  useEffect(() => {
    async function fetchProjectName() {
      if (!isProjectsRoute && projectId) {
        try {
          const project = await getProjectConfig(projectId);
          setProjectName(project.name);
        } catch (error) {
          console.error('Failed to fetch project name:', error);
          setProjectName("Select Project");
        }
      }
    }
    fetchProjectName();
  }, [projectId, isProjectsRoute]);



  const handleCreateAssistant = async () => {
    if (!assistantPrompt.trim()) return;

    setIsCreatingAssistant(true);
    try {
      await createProjectWithOptions({
        name: assistantName || 'New Assistant',
        prompt: assistantPrompt,
        router,
        onSuccess: () => {
          onCreateModalClose();
        },
        onError: (error) => {
          console.error('Error creating assistant:', error);
        }
      });
    } finally {
      setIsCreatingAssistant(false);
    }
  };

  const handleCreateModalClose = () => {
    setAssistantName("");
    setAssistantPrompt("");
    onCreateModalClose();
  };

  const navItems = [
    {
      href: 'workflow',
      label: 'Build',
      icon: WorkflowIcon,
      requiresProject: true
    },
    {
      href: 'conversations',
      label: 'Conversations',
      icon: MessageSquareIcon,
      requiresProject: true
    },
    {
      href: 'jobs',
      label: 'Jobs',
      icon: LogsIcon,
      requiresProject: true
    },
    {
      href: 'scheduled-job-rules',
      label: 'Scheduled Job Rules',
      icon: Clock,
      requiresProject: true
    },
    {
      href: 'config',
      label: 'Settings',
      icon: SettingsIcon,
      requiresProject: true
    }
  ];

  const projectsNavItems: Array<{
    href: string;
    label: string;
    icon: any;
    requiresProject: boolean;
  }> = [];

  const handleStartTour = () => {
    localStorage.removeItem('user_product_tour_completed');
    window.location.reload();
  };

  return (
    <>
      <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-transparent flex flex-col h-full transition-all duration-300`}>
        <div className="flex flex-col grow">
          {/* Rowboat Logo */}
          <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
            <Tooltip content={collapsed ? "Rowboat" : ""} showArrow placement="right">
              <Link
                href="/projects"
                className={`
                  w-full flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all
                  ${collapsed ? 'py-3' : 'gap-3 px-4 py-2.5 justify-start'}
                `}
              >
                <Image
                  src={logoImage}
                  alt="Rowboat"
                  width={collapsed ? 24 : 24}
                  height={collapsed ? 24 : 24}
                  className="rounded-full transition-all duration-200 flex-shrink-0"
                />
                {!collapsed && (
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Rowboat
                  </span>
                )}
              </Link>
            </Tooltip>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 space-y-4">
            {!isProjectsRoute && projectId && (
              // Project-specific navigation
              navItems.map((item) => {
                const Icon = item.icon;
                const fullPath = `/projects/${projectId}/${item.href}`;
                const isActive = pathname.startsWith(fullPath);
                const isDisabled = isProjectsRoute && item.requiresProject;
                
                return (
                  <Tooltip 
                    key={item.href}
                    content={collapsed ? item.label : ""}
                    showArrow 
                    placement="right"
                  >
                    <Link 
                      href={isDisabled ? '#' : fullPath}
                      className={`
                        relative w-full rounded-md flex items-center
                        text-[15px] font-medium transition-all duration-200
                        ${collapsed ? 'justify-center py-4' : 'px-2.5 py-3 gap-2.5'}
                        ${isActive 
                          ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-l-2 border-indigo-600 dark:border-indigo-400' 
                          : isDisabled
                            ? 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-300'
                        }
                        ${isDisabled ? 'pointer-events-none' : ''}
                      `}
                      data-tour-target={item.href === 'config' ? 'settings' : item.href === 'sources' ? 'entity-data-sources' : undefined}
                    >
                      <Icon 
                        size={collapsed ? COLLAPSED_ICON_SIZE : EXPANDED_ICON_SIZE} 
                        className={`
                          transition-all duration-200
                          ${isDisabled 
                            ? 'text-zinc-300 dark:text-zinc-600' 
                            : isActive
                              ? 'text-indigo-600 dark:text-indigo-400'
                              : 'text-zinc-500 dark:text-zinc-400'
                          }
                        `}
                      />
                      {!collapsed && (
                        <span>{item.label}</span>
                      )}
                    </Link>
                  </Tooltip>
                );
              })
            )}
          </nav>
        </div>

        {/* Bottom section */}
        <div className="mt-auto">
          {/* Collapse Toggle Button */}
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              onClick={onToggleCollapse}
              className="w-full flex items-center justify-center p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all"
            >
              {collapsed ? (
                <ChevronRightIcon size={20} className="text-zinc-500 dark:text-zinc-400" />
              ) : (
                <ChevronLeftIcon size={20} className="text-zinc-500 dark:text-zinc-400" />
              )}
            </button>
          </div>

          {/* Theme and Auth Controls */}
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
            {USE_PRODUCT_TOUR && !isProjectsRoute && (
              <Tooltip content={collapsed ? "Help" : ""} showArrow placement="right">
                <button 
                  onClick={showHelpModal}
                  className={`
                    w-full rounded-md flex items-center
                    text-[15px] font-medium transition-all duration-200
                    ${collapsed ? 'justify-center py-4' : 'px-4 py-4 gap-3'}
                    hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                    text-zinc-600 dark:text-zinc-400
                  `}
                  data-tour-target="tour-button"
                >
                  <HelpCircle size={COLLAPSED_ICON_SIZE} />
                  {!collapsed && <span>Help</span>}
                </button>
              </Tooltip>
            )}

            <Tooltip content={collapsed ? "Appearance" : ""} showArrow placement="right">
              <button 
                onClick={toggleTheme}
                className={`
                  w-full rounded-md flex items-center
                  text-[15px] font-medium transition-all duration-200
                  ${collapsed ? 'justify-center py-4' : 'px-4 py-4 gap-3'}
                  hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                  text-zinc-600 dark:text-zinc-400
                `}
              >
                { theme == "light" ? <Moon size={COLLAPSED_ICON_SIZE} /> : <Sun size={COLLAPSED_ICON_SIZE} /> }
                {!collapsed && <span>Appearance</span>}
              </button>
            </Tooltip>

            {useAuth && (
              <Tooltip content={collapsed ? "Account" : ""} showArrow placement="right">
                <div 
                  className={`
                    w-full rounded-md flex items-center
                    text-[15px] font-medium transition-all duration-200
                    ${collapsed ? 'justify-center py-4' : 'px-4 py-4 gap-3'}
                    hover:bg-zinc-100 dark:hover:bg-zinc-800/50
                  `}
                >
                  <UserButton useBilling={useBilling} />
                  {!collapsed && <span>Account</span>}
                </div>
              </Tooltip>
            )}
          </div>
        </div>
      </aside>


      {/* Create Assistant Modal */}
      <Modal 
        isOpen={isCreateModalOpen} 
        onClose={handleCreateModalClose}
        size="2xl"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Create New Assistant
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {/* Assistant Name Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Assistant Name
                </label>
                <input
                  type="text"
                  value={assistantName}
                  onChange={(e) => setAssistantName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Assistant 1"
                />
              </div>

              {/* Assistant Description/Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  What do you want to build?
                </label>
                <TextareaWithSend
                  value={assistantPrompt}
                  onChange={setAssistantPrompt}
                  onSubmit={handleCreateAssistant}
                  isSubmitting={isCreatingAssistant}
                  placeholder="Example: Create a customer support assistant that can handle product inquiries and returns"
                  className="w-full min-h-[120px] border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400">
                In the next step, our AI copilot will create agents for you, complete with mock-tools.
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              onClick={handleCreateModalClose}
              disabled={isCreatingAssistant}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateAssistant}
              disabled={isCreatingAssistant || !assistantPrompt.trim()}
            >
              {isCreatingAssistant ? "Creating..." : "Create Assistant"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

    </>
  );
} 
'use client';
import { useEffect, useState } from 'react';
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Tooltip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
import { UserButton } from "@/app/lib/components/user_button";
import { 
  SettingsIcon, 
  WorkflowIcon, 
  PlayIcon,
  FolderOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Moon,
  Sun,
  HelpCircle,
  MessageSquareIcon,
  LogsIcon
} from "lucide-react";
import { getProjectConfig, listProjects, createProject } from "@/app/actions/project_actions";
import { useTheme } from "@/app/providers/theme-provider";
import { USE_PRODUCT_TOUR } from '@/app/lib/feature_flags';
import { useHelpModal } from "@/app/providers/help-modal-provider";
import { Project } from "@/app/lib/types/project_types";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Plus } from "lucide-react";
import { CreateProject } from "@/app/projects/components/create-project";

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
  const [allProjects, setAllProjects] = useState<z.infer<typeof Project>[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [assistantName, setAssistantName] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [isCreatingAssistant, setIsCreatingAssistant] = useState(false);
  const [defaultName, setDefaultName] = useState('Assistant 1');
  const [isProjectPaneOpen, setIsProjectPaneOpen] = useState(false);
  const isProjectsRoute = pathname === '/projects';
  const { theme, toggleTheme } = useTheme();
  const { showHelpModal } = useHelpModal();
  const { isOpen: isAssistantsModalOpen, onOpen: onAssistantsModalOpen, onClose: onAssistantsModalClose } = useDisclosure();
  const { isOpen: isCreateModalOpen, onOpen: onCreateModalOpen, onClose: onCreateModalClose } = useDisclosure();
  const { isOpen: isNewProjectModalOpen, onOpen: onNewProjectModalOpen, onClose: onNewProjectModalClose } = useDisclosure();

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

  // Load projects when modal opens
  useEffect(() => {
    async function loadProjects() {
      if ((isAssistantsModalOpen || isNewProjectModalOpen) && !isProjectsRoute) {
        setIsLoadingProjects(true);
        try {
          const projects = await listProjects();
          // For assistants modal, filter out current project
          const otherProjects = isAssistantsModalOpen ? projects.filter(p => p._id !== projectId) : projects;
          const sortedProjects = [...otherProjects].sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          setAllProjects(sortedProjects);
          
          // Calculate default name for new project
          const getNextAssistantNumber = () => {
            const untitledProjects = projects
              .map(p => p.name)
              .filter(name => name.startsWith('Assistant '))
              .map(name => {
                const num = parseInt(name.replace('Assistant ', ''));
                return isNaN(num) ? 0 : num;
              });

            if (untitledProjects.length === 0) return 1;
            return Math.max(...untitledProjects) + 1;
          };
          
          const nextNumber = getNextAssistantNumber();
          setDefaultName(`Assistant ${nextNumber}`);
        } catch (error) {
          console.error('Failed to fetch projects:', error);
        } finally {
          setIsLoadingProjects(false);
        }
      }
    }

    loadProjects();
  }, [isAssistantsModalOpen, isNewProjectModalOpen, projectId, isProjectsRoute]);

  // Generate default assistant name when create modal opens
  useEffect(() => {
    if (isCreateModalOpen && !assistantName) {
      const getNextAssistantNumber = () => {
        const untitledProjects = allProjects
          .map(p => p.name)
          .filter(name => name.startsWith('Assistant '))
          .map(name => {
            const num = parseInt(name.replace('Assistant ', ''));
            return isNaN(num) ? 0 : num;
          });

        if (untitledProjects.length === 0) return 1;
        return Math.max(...untitledProjects) + 1;
      };

      const nextNumber = getNextAssistantNumber();
      setAssistantName(`Assistant ${nextNumber}`);
    }
  }, [isCreateModalOpen, allProjects, assistantName]);

  const handleCreateAssistant = async () => {
    if (!assistantPrompt.trim()) return;

    setIsCreatingAssistant(true);
    try {
      const formData = new FormData();
      formData.append('name', assistantName || 'New Assistant');

      const response = await createProject(formData);
      if ('id' in response) {
        // Store prompt in localStorage for the copilot to use
        if (assistantPrompt.trim()) {
          localStorage.setItem(`project_prompt_${response.id}`, assistantPrompt);
        }
        // Close modals and navigate
        onCreateModalClose();
        onAssistantsModalClose();
        router.push(`/projects/${response.id}/workflow`);
      }
    } catch (error) {
      console.error('Error creating assistant:', error);
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
      href: 'config',
      label: 'Settings',
      icon: SettingsIcon,
      requiresProject: true
    }
  ];

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
                  w-full flex items-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all
                  ${collapsed ? 'justify-center py-4' : 'gap-3 px-4 py-2.5'}
                `}
              >
                <Image
                  src="/logo-only.png"
                  alt="Rowboat"
                  width={collapsed ? 20 : 24}
                  height={collapsed ? 20 : 24}
                  className="rounded-full transition-all duration-200"
                />
                {!collapsed && (
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Rowboat
                  </span>
                )}
              </Link>
            </Tooltip>
          </div>

          {!isProjectsRoute && (
            <>
              {/* Project Selector */}
              <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 space-y-2">
                <Tooltip content={collapsed ? "Change Assistant" : ""} showArrow placement="right">
                  <button 
                    onClick={onAssistantsModalOpen}
                    className={`
                      flex items-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all
                      ${collapsed ? 'justify-center py-4' : 'gap-3 px-4 py-2.5'}
                    `}
                  >
                    <FolderOpenIcon 
                      size={collapsed ? COLLAPSED_ICON_SIZE : EXPANDED_ICON_SIZE} 
                      className="text-zinc-500 dark:text-zinc-400 transition-all duration-200" 
                    />
                    {!collapsed && (
                      <span className="text-sm font-medium">
                        Change Assistant
                      </span>
                    )}
                  </button>
                </Tooltip>
                
                <Tooltip content={collapsed ? "New Project" : ""} showArrow placement="right">
                  <button 
                    onClick={onNewProjectModalOpen}
                    className={`
                      w-full flex items-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-all
                      ${collapsed ? 'justify-center py-4' : 'gap-3 px-4 py-2.5'}
                    `}
                  >
                    <Plus 
                      size={collapsed ? COLLAPSED_ICON_SIZE : EXPANDED_ICON_SIZE} 
                      className="text-zinc-500 dark:text-zinc-400 transition-all duration-200" 
                    />
                    {!collapsed && (
                      <span className="text-sm font-medium">
                        New Project
                      </span>
                    )}
                  </button>
                </Tooltip>
              </div>

              {/* Project-specific navigation Items */}
              {projectId && <nav className="p-3 space-y-4">
                {navItems.map((item) => {
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
                })}
              </nav>}
            </>
          )}
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

      {/* Assistants Modal */}
      <Modal 
        isOpen={isAssistantsModalOpen} 
        onClose={onAssistantsModalClose}
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Select Assistant
          </ModalHeader>
          <ModalBody>
            <div className="space-y-2">
              {isLoadingProjects ? (
                <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
                  Loading assistants...
                </div>
              ) : allProjects.length > 0 ? (
                <>
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 px-1 py-2">
                    Existing Assistants ({allProjects.length})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto p-1">
                    {allProjects.map((project) => (
                      <Link
                        key={project._id}
                        href={`/projects/${project._id}/workflow`}
                        onClick={onAssistantsModalClose}
                        className="block p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all group"
                      >
                        <div className="space-y-2">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                            {project.name}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-500">
                            Created {new Date(project.createdAt).toLocaleDateString()}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-zinc-400 dark:text-zinc-600">
                              Last updated {new Date(project.lastUpdatedAt).toLocaleDateString()}
                            </div>
                            <div className="w-2 h-2 rounded-full bg-green-500 opacity-75"></div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-sm text-zinc-500 dark:text-zinc-500 text-center py-8">
                  No other assistants found
                </div>
              )}
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

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
                <div className="relative">
                  <Textarea
                    value={assistantPrompt}
                    onChange={(e) => setAssistantPrompt(e.target.value)}
                    placeholder="Example: Create a customer support assistant that can handle product inquiries and returns"
                    className="w-full pr-14 min-h-[120px] border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleCreateAssistant();
                      }
                    }}
                  />
                  <div className="absolute right-3 bottom-3">
                    <button
                      onClick={handleCreateAssistant}
                      disabled={isCreatingAssistant || !assistantPrompt.trim()}
                      className={`
                        rounded-full p-2 transition-all duration-200
                        ${assistantPrompt.trim()
                          ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:hover:bg-indigo-800/60 dark:text-indigo-300"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                        }
                        ${isCreatingAssistant ? "opacity-50" : "hover:scale-105 active:scale-95"}
                      `}
                    >
                      {isCreatingAssistant ? (
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
                      ) : (
                        <Send size={18} />
                      )}
                    </button>
                  </div>
                </div>
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

      {/* New Project Modal - matches projects/select view */}
      <Modal 
        isOpen={isNewProjectModalOpen} 
        onClose={onNewProjectModalClose}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Create New Assistant
          </ModalHeader>
          <ModalBody className="p-0">
            <div className="p-8">
              <CreateProject
                defaultName={defaultName}
                onOpenProjectPane={() => setIsProjectPaneOpen(false)}
                isProjectPaneOpen={false}
                hideHeader={true}
              />
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
} 
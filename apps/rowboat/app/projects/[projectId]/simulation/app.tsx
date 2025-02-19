'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlusIcon, PencilIcon, XMarkIcon, EllipsisVerticalIcon, TrashIcon, ChevronRightIcon, PlayIcon, ChevronDownIcon, ChevronLeftIcon } from '@heroicons/react/24/outline';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { 
    getScenarios, 
    createScenario, 
    updateScenario, 
    deleteScenario,
    getRuns,
    getRun,
    getRunResults,
    createRun,
    createRunResult,
    updateRunStatus,
    createAggregateResult,
    deleteRun,
} from '../../../actions/simulation_actions';
import { type WithStringId } from '../../../lib/types/types';
import { Scenario, SimulationRun, SimulationResult } from "../../../lib/types/testing_types";
import { Workflow } from "../../../lib/types/workflow_types";
import { z } from 'zod';
import { SimulationResultCard, ScenarioResultCard } from './components/RunComponents';
import { ScenarioList, ScenarioViewer } from './components/ScenarioComponents';
import { fetchWorkflow } from '../../../actions/workflow_actions';
import { StructuredPanel, ActionButton } from "../../../lib/components/structured-panel";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "../../../../components/ui/resizable"
import { Pagination } from "../../../lib/components/pagination";

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;
type SimulationRunType = WithStringId<z.infer<typeof SimulationRun>>;
type SimulationResultType = WithStringId<z.infer<typeof SimulationResult>>;

type SimulationReport = {
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  results: z.infer<typeof SimulationResult>[];
  timestamp: Date;
};

const dummySimulator = async (scenario: ScenarioType, runId: string, projectId: string): Promise<z.infer<typeof SimulationResult>> => {
  await new Promise(resolve => setTimeout(resolve, 500));
  const passed = Math.random() > 0.5;
  
  const result: z.infer<typeof SimulationResult> = {
    projectId: projectId,
    runId: runId,
    scenarioId: scenario._id,
    result: passed ? 'pass' : 'fail' as const,
    details: passed 
      ? "The bot successfully completed the conversation"
      : "The bot could not handle the conversation",
  };

  await createRunResult(
    projectId,
    runId,
    scenario._id,
    result.result,
    result.details
  );

  return result;
};

export default function SimulationApp() {
  const { projectId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [scenarios, setScenarios] = useState<ScenarioType[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioType | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [menuOpenScenarioId, setMenuOpenScenarioId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [simulationReport, setSimulationReport] = useState<SimulationReport | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [runs, setRuns] = useState<SimulationRunType[]>([]);
  const [activeRun, setActiveRun] = useState<SimulationRunType | null>(null);
  const [runResults, setRunResults] = useState<SimulationResultType[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [allRunResults, setAllRunResults] = useState<Record<string, SimulationResultType[]>>({});
  const [workflowVersions, setWorkflowVersions] = useState<Record<string, WithStringId<z.infer<typeof Workflow>>>>({});
  const [menuOpenId, setMenuOpenIdState] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get('page')) || 1);
  const runsPerPage = 10;

  const setMenuOpenId = useCallback((id: string | null) => {
    setMenuOpenIdState(id);
  }, []);

  // Load scenarios on mount
  useEffect(() => {
    if (!projectId) return;
    getScenarios(projectId as string).then(setScenarios);
  }, [projectId]);

  useEffect(() => {
    if (menuOpenScenarioId) {
      const closeMenu = () => setMenuOpenScenarioId(null);
      window.addEventListener('click', closeMenu);
      return () => window.removeEventListener('click', closeMenu);
    }
  }, [menuOpenScenarioId]);

  // Modify the fetchRuns function to also fetch results
  const fetchRuns = useCallback(async () => {
    if (!projectId) return;
    setIsLoadingRuns(true);
    try {
      const runsData = await getRuns(projectId as string);
      setRuns(runsData);
      
      // Fetch results for all runs
      const resultsPromises = runsData.map(run => 
        getRunResults(projectId as string, run._id)
      );
      const allResults = await Promise.all(resultsPromises);
      
      // Create a map of run ID to results
      const resultsMap = runsData.reduce((acc, run, index) => ({
        ...acc,
        [run._id]: allResults[index]
      }), {});
      
      setAllRunResults(resultsMap);
    } catch (error) {
      console.error('Error fetching runs:', error);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [projectId]);

  // Update the useEffect hooks to include fetchRuns
  useEffect(() => {
    if (!projectId) return;
    fetchRuns();
  }, [projectId, fetchRuns]);

  useEffect(() => {
    if (!projectId || !activeRun || activeRun.status === 'completed' || activeRun.status === 'cancelled') return;

    const interval = setInterval(async () => {
        try {
            const updatedRun = await getRun(projectId as string, activeRun._id);
            setActiveRun(updatedRun);

            if (updatedRun.status === 'completed') {
                const results = await getRunResults(projectId as string, activeRun._id);
                setRunResults(results);
                fetchRuns(); // Refresh the runs list
            }
        } catch (error) {
            console.error('Error polling run status:', error);
        }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeRun, projectId, fetchRuns]);

  const createNewScenario = async () => {
    if (!projectId) return;
    const newScenarioId = await createScenario(
      projectId as string,
      'New Scenario',
      ''
    );
    // Refresh scenarios list
    const updatedScenarios = await getScenarios(projectId as string);
    setScenarios(updatedScenarios);
    const newScenario = updatedScenarios.find(s => s._id === newScenarioId);
    if (newScenario) {
      setSelectedScenario(newScenario);
      setIsEditing(true);
    }
  };

  const handleUpdateScenario = async (updatedScenario: ScenarioType) => {
    if (!projectId) return;
    
    // First verify the scenario exists and get its current state
    const currentScenarios = await getScenarios(projectId as string);
    const existingScenario = currentScenarios.find(s => s._id === updatedScenario._id);
    
    if (!existingScenario) {
      console.error('Scenario not found');
      return;
    }

    // Only update the specific fields that have changed
    await updateScenario(
      projectId as string,
      updatedScenario._id,
      {
        name: updatedScenario.name,
        description: updatedScenario.description,
        criteria: updatedScenario.criteria,
        context: updatedScenario.context,
      }
    );

    // Just refresh the scenarios list without setting selected scenario
    const updatedScenarios = await getScenarios(projectId as string);
    setScenarios(updatedScenarios);
    setIsEditing(false);
  };

  const handleCloseScenario = () => {
    setSelectedScenario(null);
    setIsEditing(false);
  };

  const handleDeleteScenario = async (scenarioId: string) => {
    if (!projectId) return;
    await deleteScenario(projectId as string, scenarioId);
    const updatedScenarios = await getScenarios(projectId as string);
    setScenarios(updatedScenarios);
    if (selectedScenario?._id === scenarioId) {
      setSelectedScenario(null);
      setIsEditing(false);
    }
    setMenuOpenScenarioId(null);
  };

  const runAllScenarios = async () => {
    if (!projectId) return;
    setIsRunning(true);
    setSimulationReport(null);

    try {
        // Get workflowId from localStorage
        const workflowId = localStorage.getItem(`lastWorkflowId_${projectId}`);
        if (!workflowId) {
            throw new Error('No workflow selected. Please select a workflow first.');
        }

        // First verify the workflow exists before creating the run
        let workflow;
        try {
            workflow = await fetchWorkflow(projectId as string, workflowId);
        } catch (error) {
            // If workflow doesn't exist, clear localStorage and throw error
            localStorage.removeItem(`lastWorkflowId_${projectId}`);
            throw new Error('Selected workflow no longer exists. Please select a new workflow.');
        }

        const newRun = await createRun(
            projectId as string,
            scenarios.map(s => s._id),
            workflowId
        );
        setActiveRun(newRun);

        // Store workflow version
        setWorkflowVersions(prev => ({
            ...prev,
            [workflowId]: workflow
        }));

        const shouldMock = process.env.NEXT_PUBLIC_MOCK_SIMULATION_RESULTS === 'true';
        
        if (shouldMock) {
            console.log('Using mock simulation...');
            
            await updateRunStatus(projectId as string, newRun._id, 'running');
            
            // Run all scenarios and collect results
            const mockResults = await Promise.all(
                scenarios.map(scenario => 
                    dummySimulator(scenario, newRun._id, projectId as string)
                )
            );

            // Calculate and store aggregate results before marking as complete
            const total = scenarios.length;
            const pass = mockResults.filter(r => r.result === 'pass').length;
            const fail = mockResults.filter(r => r.result === 'fail').length;

            await createAggregateResult(
                projectId as string,
                newRun._id,
                total,
                pass,
                fail
            );

            await updateRunStatus(
                projectId as string, 
                newRun._id, 
                'completed',
                new Date().toISOString()
            );

            const results = await getRunResults(projectId as string, newRun._id);
            setRunResults(results);
            
            const updatedRun = await getRun(projectId as string, newRun._id);
            setActiveRun(updatedRun);
        }
        
        await fetchRuns();
    } catch (error) {
        console.error('Error starting scenarios:', error);
        alert(error instanceof Error ? error.message : 'An error occurred while starting scenarios');
    } finally {
        setIsRunning(false);
    }
  };

  const runSingleScenario = (scenario: ScenarioType) => {
    // Store scenario ID in localStorage instead of URL parameter
    localStorage.setItem('pendingScenarioId', scenario._id);
    // Navigate to the playground without query parameter
    router.push(`/projects/${projectId}/workflow`);
    setMenuOpenScenarioId(null);
  };

  // Update the workflow versions fetching effect
  useEffect(() => {
    if (!projectId || !runs.length) return;

    const fetchWorkflowVersions = async () => {
        const workflowIds = Array.from(new Set(runs.map(run => run.workflowId)));
        const versions: Record<string, WithStringId<z.infer<typeof Workflow>>> = {};

        for (const workflowId of workflowIds) {
            try {
                const workflow = await fetchWorkflow(projectId as string, workflowId);
                versions[workflowId] = workflow;
            } catch (error) {
                console.error(`Error fetching workflow ${workflowId}:`, error);
                // Add a placeholder for deleted/invalid workflows
                versions[workflowId] = {
                    _id: workflowId,
                    name: "Deleted/Invalid Workflow",
                    projectId: projectId as string,
                    agents: [],
                    prompts: [],
                    tools: [],
                    startAgent: "",
                    createdAt: new Date().toISOString(),
                    lastUpdatedAt: new Date().toISOString(),
                };
            }
        }

        setWorkflowVersions(versions);
    };

    fetchWorkflowVersions();
  }, [projectId, runs]);

  const handleCancelRun = async (runId: string) => {
    if (!projectId) return;
    try {
      await updateRunStatus(projectId as string, runId, 'cancelled');
      await fetchRuns(); // Refresh the runs list
    } catch (error) {
      console.error('Error cancelling run:', error);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!projectId) return;
    try {
      await deleteRun(projectId as string, runId);
      await fetchRuns(); // Refresh the runs list
    } catch (error) {
      console.error('Error deleting run:', error);
    }
  };

  // Add this effect to update currentPage when URL changes
  useEffect(() => {
    const page = Number(searchParams.get('page')) || 1;
    setCurrentPage(page);
  }, [searchParams]);

  const indexOfLastRun = currentPage * runsPerPage;
  const indexOfFirstRun = indexOfLastRun - runsPerPage;
  const currentRuns = runs.slice(indexOfFirstRun, indexOfLastRun);
  const totalPages = Math.ceil(runs.length / runsPerPage);

  return (
    <ResizablePanelGroup direction="horizontal" className="h-screen gap-1">
      <ResizablePanel minSize={10} defaultSize={15}>
        <ScenarioList
          scenarios={scenarios}
          selectedId={selectedScenario?._id ?? null}
          onSelect={(id) => setSelectedScenario(scenarios.find(s => s._id === id) ?? null)}
          onAdd={createNewScenario}
          onRunScenario={(id) => {
            const scenario = scenarios.find(s => s._id === id);
            if (scenario) runSingleScenario(scenario);
          }}
          onDeleteScenario={(id) => handleDeleteScenario(id)}
        />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel minSize={20} defaultSize={85} className="overflow-auto">
        {selectedScenario ? (
          <ScenarioViewer
            scenario={selectedScenario}
            onSave={handleUpdateScenario}
            onClose={handleCloseScenario}
          />
        ) : (
          <StructuredPanel 
            title="SIMULATION RUNS"
            tooltip="Run and view simulations"
            actions={[
              <ActionButton
                key="run-all"
                onClick={() => void runAllScenarios()}
                disabled={isRunning}
                icon={<PlayIcon className="w-4 h-4" />}
                primary
              >
                Run All Scenarios
              </ActionButton>
            ]}
          >
            <div className="p-6">
              {/* Runs list */}
              {isLoadingRuns ? (
                <div>Loading runs...</div>
              ) : (
                <div className="space-y-4">
                  {currentRuns.map((run) => (
                    <SimulationResultCard
                      key={run._id}
                      run={run}
                      results={allRunResults[run._id] || []}
                      scenarios={scenarios}
                      workflow={workflowVersions[run.workflowId]}
                      onCancelRun={handleCancelRun}
                      onDeleteRun={handleDeleteRun}
                      menuOpenId={menuOpenId}
                      setMenuOpenId={setMenuOpenId}
                    />
                  ))}
                </div>
              )}

              {/* Pagination */}
              {runs.length > runsPerPage && (
                <div className="flex justify-center mt-4">
                  <Pagination
                    total={totalPages}
                    page={currentPage}
                  />
                </div>
              )}
            </div>
          </StructuredPanel>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

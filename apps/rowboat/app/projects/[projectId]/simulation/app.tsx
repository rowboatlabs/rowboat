'use client';

import { useState, useEffect, useCallback } from 'react';
import { PlusIcon, PencilIcon, XMarkIcon, DocumentDuplicateIcon, EllipsisVerticalIcon, TrashIcon, ChevronRightIcon, PlayIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useParams, useRouter } from 'next/navigation';
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
} from '../../../actions/simulation_actions';
import { type WithStringId } from '../../../lib/types/types';
import { Scenario, SimulationRun, SimulationResult } from "../../../lib/types/testing_types";
import { z } from 'zod';

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
  
  // Create the result object with explicitly typed result
  const result: z.infer<typeof SimulationResult> = {
    projectId: projectId,
    runId: runId,
    scenarioId: scenario._id,
    result: passed ? 'pass' : 'fail' as const,  // explicitly type as literal
    details: passed 
      ? "The bot successfully completed the conversation"
      : "The bot could not handle the conversation",
  };

  // Write to DB using server action
  await createRunResult(
    projectId,
    runId,
    scenario._id,
    result.result,
    result.details
  );

  return result;
};

interface SimulationResultCardProps {
  run: SimulationRunType;
  results: SimulationResultType[];
  scenarios: ScenarioType[];
}

interface ScenarioResultCardProps {
  scenario: ScenarioType;
  result?: SimulationResultType;
}

const SimulationResultCard = ({ run, results, scenarios }: SimulationResultCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());

  const statusLabelClass = "px-3 py-1 rounded text-xs min-w-[60px] text-center uppercase font-semibold";

  const formatMainTitle = (date: string) => {
    return `Run from ${new Date(date).toLocaleString('en-US', { 
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    })}`;
  };

  const formatDateTime = (date: string) => {
    return new Date(date).toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  // Calculate statistics and duration
  const totalScenarios = run.scenarioIds.length;
  const passedScenarios = results.filter(r => r.result === 'pass').length;
  const failedScenarios = results.filter(r => r.result === 'fail').length;

  const getDuration = () => {
    if (!run.completedAt) return 'In Progress';
    const start = new Date(run.startedAt);
    const end = new Date(run.completedAt);
    const diff = end.getTime() - start.getTime();
    return `${(diff / 1000).toFixed(1)}s`;
  };

  const toggleScenario = (scenarioId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering parent's onClick
    setExpandedScenarios(prev => {
      const newSet = new Set(prev);
      if (newSet.has(scenarioId)) {
        newSet.delete(scenarioId);
      } else {
        newSet.add(scenarioId);
      }
      return newSet;
    });
  };

  return (
    <div className="border rounded-lg mb-4 shadow-sm">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-2">
          {isExpanded ? (
            <ChevronDownIcon className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-5 w-5 text-gray-400" />
          )}
          <div className="text-lg font-semibold">
            {formatMainTitle(run.startedAt)}
          </div>
        </div>
        <span className={`${statusLabelClass} ${
          run.status === 'completed' ? 'bg-green-100 text-green-800' :
          run.status === 'failed' ? 'bg-red-100 text-red-800' :
          'bg-yellow-100 text-yellow-800'
        }`}>
          {run.status}
        </span>
      </div>

      {isExpanded && (
        <div className="p-4 border-t">
          {/* Simplified timing information */}
          <div className="mb-6 text-sm text-gray-500 space-y-1">
            <div className="flex items-center">
              <span className="w-24 text-gray-600">Completed:</span>
              <span>{run.completedAt ? formatDateTime(run.completedAt) : 'Not completed'}</span>
            </div>
            <div className="flex items-center">
              <span className="w-24 text-gray-600">Duration:</span>
              <span>{getDuration()}</span>
            </div>
          </div>

          {/* Results statistics */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-gray-50">
              <div className="text-sm text-gray-600">Total Scenarios</div>
              <div className="text-2xl font-semibold">{totalScenarios}</div>
            </div>
            <div className="p-4 rounded-lg bg-green-50">
              <div className="text-sm text-green-600">Passed</div>
              <div className="text-2xl font-semibold text-green-700">{passedScenarios}</div>
            </div>
            <div className="p-4 rounded-lg bg-red-50">
              <div className="text-sm text-red-600">Failed</div>
              <div className="text-2xl font-semibold text-red-700">{failedScenarios}</div>
            </div>
          </div>
          
          <div className="space-y-2">
            {run.scenarioIds.map(scenarioId => {
              const scenario = scenarios.find(s => s._id === scenarioId);
              const result = results.find(r => r.scenarioId === scenarioId);
              const isScenarioExpanded = expandedScenarios.has(scenarioId);
              
              return scenario && (
                <div 
                  key={scenarioId} 
                  className={`border rounded-lg overflow-hidden ${
                    result?.result === 'pass' ? 'bg-green-50 border-green-200' : 
                    result?.result === 'fail' ? 'bg-red-50 border-red-200' : 
                    'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div 
                    className="p-3 flex items-center justify-between cursor-pointer hover:bg-opacity-80"
                    onClick={(e) => toggleScenario(scenarioId, e)}
                  >
                    <div className="flex items-center space-x-2">
                      {isScenarioExpanded ? (
                        <ChevronDownIcon className="h-4 w-4 text-gray-600" />
                      ) : (
                        <ChevronRightIcon className="h-4 w-4 text-gray-600" />
                      )}
                      <span className="font-medium text-gray-900">{scenario.name}</span>
                    </div>
                    {result && (
                      <span className={`${statusLabelClass} ${
                        result.result === 'pass' ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'
                      }`}>
                        {result.result}
                      </span>
                    )}
                  </div>

                  {isScenarioExpanded && (
                    <div className="p-3 border-t border-opacity-50 space-y-4">
                      <div>
                        <div className="text-sm font-medium mb-1">Description</div>
                        <div className="text-sm text-gray-700">
                          {scenario.description}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium mb-1">Context</div>
                        <div className="text-sm text-gray-700">
                          {scenario.context || 'No context provided'}
                        </div>
                      </div>
                      {result && (
                        <div>
                          <div className="text-sm font-medium mb-1">Result Details</div>
                          <div className="text-sm text-gray-700">
                            {result.details}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ScenarioResultCard = ({ scenario, result }: ScenarioResultCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border rounded-lg mb-2 last:mb-0">
      <div 
        className="p-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-2">
          {isExpanded ? (
            <ChevronDownIcon className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-4 w-4 text-gray-400" />
          )}
          <span className="font-medium">{scenario.name}</span>
        </div>
        {result && (
          <span className={`px-2 py-1 rounded-full text-xs ${
            result.result === 'pass' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {result.result}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="p-3 border-t space-y-2 bg-gray-50">
          <div>
            <div className="text-sm font-medium text-gray-600">Description</div>
            <div className="text-sm">{scenario.description}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-600">Context</div>
            <div className="text-sm">{scenario.context || 'No context provided'}</div>
          </div>
          {result && (
            <div>
              <div className="text-sm font-medium text-gray-600">Result Details</div>
              <div className="text-sm">{result.details}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function SimulationApp() {
  const { projectId } = useParams();
  const router = useRouter();
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
    await updateScenario(
      projectId as string,
      updatedScenario._id,
      {
        name: updatedScenario.name,
        description: updatedScenario.description,
        context: updatedScenario.context,
      }
    );
    // Refresh scenarios list
    const updatedScenarios = await getScenarios(projectId as string);
    setScenarios(updatedScenarios);
    const refreshedScenario = updatedScenarios.find(s => s._id === updatedScenario._id);
    if (refreshedScenario) {
      setSelectedScenario(refreshedScenario);
    }
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
      // Create a new run using server action
      const newRun = await createRun(
        projectId as string,
        scenarios.map(s => s._id)
      );
      setActiveRun(newRun);

      // Check for the NEXT_PUBLIC_ prefixed env variable
      if (process.env.NEXT_PUBLIC_MOCK_SIMULATION_RESULTS === 'true') {
        console.log('Using mock simulation...');  // Debug log
        
        // First update run to 'running' status
        await updateRunStatus(projectId as string, newRun._id, 'running');
        
        // Generate and save all mock results
        await Promise.all(
          scenarios.map(scenario => 
            dummySimulator(scenario, newRun._id, projectId as string)
          )
        );

        // Update run status to completed
        await updateRunStatus(
          projectId as string, 
          newRun._id, 
          'completed',
          new Date().toISOString()
        );

        // Fetch the results back from DB to ensure consistency
        const results = await getRunResults(projectId as string, newRun._id);
        setRunResults(results);
        
        // Refresh the run to get its updated state
        const updatedRun = await getRun(projectId as string, newRun._id);
        setActiveRun(updatedRun);
      }
      
      await fetchRuns();
    } catch (error) {
      console.error('Error starting scenarios:', error);
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

  return (
    <div className="flex h-screen">
      {/* Left sidebar */}
      <div className="w-64 border-r border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Scenarios</h2>
          <div className="flex gap-2">
            <button
              onClick={createNewScenario}
              className="p-2 rounded-full hover:bg-gray-100"
              title="New Scenario"
            >
              <PlusIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {scenarios.map(scenario => (
            <div
              key={scenario._id}
              className={`p-2 rounded flex justify-between items-center ${
                selectedScenario?._id === scenario._id
                  ? 'bg-blue-100'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div
                onClick={() => setSelectedScenario(scenario)}
                className="cursor-pointer flex-grow"
              >
                {scenario.name}
              </div>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenScenarioId(menuOpenScenarioId === scenario._id ? null : scenario._id);
                  }}
                  className="p-1 rounded-full hover:bg-gray-200"
                >
                  <EllipsisVerticalIcon className="h-5 w-5 text-gray-600" />
                </button>
                {menuOpenScenarioId === scenario._id && (
                  <div className="absolute right-0 mt-1 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10">
                    <div className="py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          runSingleScenario(scenario);
                        }}
                        className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full"
                      >
                        <PlayIcon className="h-4 w-4 mr-2" />
                        Run Scenario
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteScenario(scenario._id);
                        }}
                        className="flex items-center px-4 py-2 text-sm text-red-600 hover:bg-gray-100 w-full"
                      >
                        <TrashIcon className="h-4 w-4 mr-2" />
                        Delete Scenario
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-6 overflow-auto">
        {selectedScenario ? (
          isEditing ? (
            <ScenarioEditor
              scenario={selectedScenario}
              onSave={handleUpdateScenario}
              onCancel={() => setIsEditing(false)}
            />
          ) : (
            <ScenarioViewer
              scenario={selectedScenario}
              onEdit={() => setIsEditing(true)}
              onClose={handleCloseScenario}
            />
          )
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center mb-6">
              <h1 className="text-2xl font-bold">Simulation Runs</h1>
              <button
                onClick={runAllScenarios}
                disabled={isRunning || scenarios.length === 0}
                className={`px-4 py-2 rounded-md text-white ${
                  isRunning || scenarios.length === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isRunning ? 'Running...' : 'Run All Scenarios'}
              </button>
            </div>

            {isLoadingRuns ? (
                <div className="text-center py-4">Loading runs...</div>
            ) : runs.length === 0 ? (
                <div className="text-center py-4 text-gray-500">No simulation runs yet</div>
            ) : (
                <div className="space-y-4">
                    {runs.map((run) => (
                        <SimulationResultCard 
                            key={run._id}
                            run={run}
                            results={allRunResults[run._id] || []}
                            scenarios={scenarios}
                        />
                    ))}
                </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ScenarioViewer({
  scenario,
  onEdit,
  onClose,
}: {
  scenario: ScenarioType;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{scenario.name}</h1>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Edit"
          >
            <PencilIcon className="h-5 w-5 text-gray-600" />
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Close"
          >
            <XMarkIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">NAME</div>
          <div className="text-base">{scenario.name}</div>
        </div>
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">DESCRIPTION</div>
          <div className="text-base whitespace-pre-wrap">{scenario.description}</div>
        </div>
        
        <div className="border-t border-gray-200 my-4"></div>
        
        <div className="flex flex-col">
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CONTEXT</div>
          <div className="text-base whitespace-pre-wrap">{scenario.context}</div>
        </div>
      </div>
    </div>
  );
}

function ScenarioEditor({
  scenario,
  onSave,
  onCancel,
}: {
  scenario: ScenarioType;
  onSave: (scenario: ScenarioType) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description);
  const [context, setContext] = useState(scenario.context || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...scenario,
      name,
      description,
      context,
    });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Edit Scenario</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Save"
          >
            <DocumentDuplicateIcon className="h-5 w-5 text-gray-600" />
          </button>
          <button
            onClick={onCancel}
            className="p-2 rounded-full hover:bg-gray-100"
            title="Close"
          >
            <XMarkIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">NAME</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
          />
        </div>

        <div className="border-t border-gray-200 my-4"></div>

        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">DESCRIPTION</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
          />
        </div>

        <div className="border-t border-gray-200 my-4"></div>

        <div>
          <div className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">CONTEXT</div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-2 border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 px-3 py-2"
          />
        </div>
      </form>
    </div>
  );
}

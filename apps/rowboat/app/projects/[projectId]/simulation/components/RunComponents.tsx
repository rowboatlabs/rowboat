'use client';

import { useState, useEffect } from 'react';
import { ChevronDownIcon, ChevronRightIcon, NoSymbolIcon, EllipsisVerticalIcon, ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { WithStringId } from '../../../../lib/types/types';
import { Scenario, SimulationRun, SimulationResult, SimulationAggregateResult } from "../../../../lib/types/testing_types";
import { z } from 'zod';
import { Workflow } from "../../../../lib/types/workflow_types";

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;
type SimulationRunType = WithStringId<z.infer<typeof SimulationRun>>;
type SimulationResultType = WithStringId<z.infer<typeof SimulationResult>>;

interface SimulationResultCardProps {
  run: SimulationRunType;
  results: SimulationResultType[];
  scenarios: ScenarioType[];
  workflow?: WithStringId<z.infer<typeof Workflow>>;
  onCancelRun?: (runId: string) => void;
  onDeleteRun?: (runId: string) => Promise<void>;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
}

export const SimulationResultCard = ({ run, results, scenarios, workflow, onCancelRun, onDeleteRun, menuOpenId, setMenuOpenId }: SimulationResultCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedScenarios, setExpandedScenarios] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const totalScenarios = run.aggregateResults?.total ?? run.scenarioIds.length;
  const passedScenarios = run.aggregateResults?.pass ?? 0;
  const failedScenarios = run.aggregateResults?.fail ?? 0;

  const statusLabelClass = "w-[110px] px-3 py-1 rounded text-xs text-center uppercase font-semibold inline-block";
  const getStatusClass = (status: string) => {
    switch (status) {
      case 'completed':
      case 'pass':
        return `${statusLabelClass} bg-green-50 text-green-800`;
      case 'failed':
      case 'fail':
        return `${statusLabelClass} bg-red-50 text-red-800`;
      case 'error':
        return `${statusLabelClass} bg-orange-50 text-orange-800`;
      case 'cancelled':
        return `${statusLabelClass} bg-gray-50 text-gray-800`;
      case 'running':
      case 'pending':
      default:
        return `${statusLabelClass} bg-yellow-50 text-yellow-800`;
    }
  };

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

  useEffect(() => {
    if (menuOpenId) {
      const closeMenu = () => setMenuOpenId(null);
      window.addEventListener('click', closeMenu);
      return () => window.removeEventListener('click', closeMenu);
    }
  }, [menuOpenId, setMenuOpenId]);

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
          <div className="text-sm truncate">
            {formatMainTitle(run.startedAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={getStatusClass(run.status)}>
            {run.status}
          </span>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenId(menuOpenId === run._id ? null : run._id);
              }}
              className="p-1 rounded-full hover:bg-gray-100"
            >
              <EllipsisVerticalIcon className="h-5 w-5 text-gray-600" />
            </button>
            
            {menuOpenId === run._id && (
              <div className="absolute right-0 mt-1 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-10">
                <div className="py-1">
                  {(run.status === 'running' || run.status === 'pending') && onCancelRun && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelRun(run._id);
                        setMenuOpenId(null);
                      }}
                      className="flex items-center px-4 py-2 text-sm text-red-600 hover:bg-gray-100 w-full"
                    >
                      <NoSymbolIcon className="h-4 w-4 mr-2" />
                      Cancel Run
                    </button>
                  )}
                  <button
                    disabled
                    className="flex items-center px-4 py-2 text-sm text-gray-400 w-full cursor-not-allowed whitespace-nowrap"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                    Download transcripts
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(true);
                      setMenuOpenId(null);
                    }}
                    className="flex items-center px-4 py-2 text-sm text-red-600 hover:bg-gray-100 w-full"
                  >
                    <TrashIcon className="h-4 w-4 mr-2" />
                    Delete run
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 border-t">
          {run.status === 'error' ? (
            <div className="text-orange-800 bg-orange-50 p-4 rounded-lg">
              Your simulation could not be completed. Please run a new simulation again.
            </div>
          ) : (
            <>
              {/* Workflow and timing information in a grid */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                {workflow && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="text-sm font-medium text-gray-600 mb-1">Workflow Version</div>
                    <div className="font-medium">{workflow.name}</div>
                  </div>
                )}
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm font-medium text-gray-600 mb-1">Completed</div>
                  <div className="text-sm">
                    {run.completedAt ? formatDateTime(run.completedAt) : 'Not completed'}
                  </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-sm font-medium text-gray-600 mb-1">Duration</div>
                  <div className="text-sm">{getDuration()}</div>
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
                          <span className={getStatusClass(result.result)}>
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
                            <div className="text-sm font-medium mb-1">Criteria</div>
                            <div className="text-sm text-gray-700">
                              {scenario.criteria || 'No criteria specified'}
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
            </>
          )}
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3 text-center">
              <h3 className="text-lg leading-6 font-medium text-gray-900 whitespace-nowrap">
                Are you sure you want to delete this run?
              </h3>
              <div className="mt-6 flex justify-center space-x-4">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 bg-white text-gray-600 text-sm font-medium border rounded-md hover:bg-gray-50"
                >
                  Retain
                </button>
                <button
                  onClick={async () => {
                    if (onDeleteRun) {
                      await onDeleteRun(run._id);
                      setShowDeleteConfirm(false);
                    }
                  }}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ScenarioResultCardProps {
  scenario: ScenarioType;
  result?: SimulationResultType;
}

export const ScenarioResultCard = ({ scenario, result }: ScenarioResultCardProps) => {
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
            <div className="text-sm font-medium text-gray-600">Criteria</div>
            <div className="text-sm">{scenario.criteria}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-600">Context</div>
            <div className="text-sm">{scenario.context}</div>
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
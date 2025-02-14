'use client';

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { WithStringId } from '../../../../lib/types/types';
import { Scenario, SimulationRun, SimulationResult } from "../../../../lib/types/testing_types";
import { z } from 'zod';

type ScenarioType = WithStringId<z.infer<typeof Scenario>>;
type SimulationRunType = WithStringId<z.infer<typeof SimulationRun>>;
type SimulationResultType = WithStringId<z.infer<typeof SimulationResult>>;

interface SimulationResultCardProps {
  run: SimulationRunType;
  results: SimulationResultType[];
  scenarios: ScenarioType[];
}

export const SimulationResultCard = ({ run, results, scenarios }: SimulationResultCardProps) => {
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
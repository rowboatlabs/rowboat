'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { MCPServer, McpTool } from '@/app/lib/types/types';
import { testMcpTool } from '@/app/actions/mcp_actions';
import { Copy, ChevronDown, ChevronRight, X, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import clsx from 'clsx';

type McpServerType = z.infer<typeof MCPServer>;
type McpToolType = z.infer<typeof McpTool>;

interface TestToolModalProps {
  isOpen: boolean;
  onClose: () => void;
  tool: McpToolType;
  server: McpServerType;
}

export function TestToolModal({ isOpen, onClose, tool, server }: TestToolModalProps) {
  const params = useParams();
  const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId?.[0];
  if (!projectId) throw new Error('Project ID is required');

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [response, setResponse] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [showInputs, setShowInputs] = useState(true);
  const [copySuccess, setCopySuccess] = useState<'request' | 'response' | null>(null);
  const [showOnlyRequired, setShowOnlyRequired] = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);

  const handleReset = () => {
    setParameters({});
    setResponse(null);
    setError(null);
    setShowRequest(false);
    setShowInputs(true);
    setValidationError(null);
    setShowRawResponse(false);
  };

  const handleParameterChange = (name: string, value: any) => {
    // Handle nested object updates
    if (name.includes('.')) {
      const parts = name.split('.');
      const topLevel = parts[0];
      const rest = parts.slice(1);
      
      setParameters(prev => {
        const current = prev[topLevel] || {};
        let temp = current;
        for (let i = 0; i < rest.length - 1; i++) {
          temp[rest[i]] = temp[rest[i]] || {};
          temp = temp[rest[i]];
        }
        temp[rest[rest.length - 1]] = value;
        
        return {
          ...prev,
          [topLevel]: current
        };
      });
    }
    // Handle array index updates
    else if (name.includes('[') && name.includes(']')) {
      const matches = name.match(/^([^\[]+)\[(\d+)\]$/);
      if (matches) {
        const [_, arrayName, index] = matches;
        setParameters(prev => {
          const array = Array.isArray(prev[arrayName]) ? [...prev[arrayName]] : [];
          array[parseInt(index, 10)] = value;
          return {
            ...prev,
            [arrayName]: array
          };
        });
      }
    }
    // Handle regular updates
    else {
      setParameters(prev => ({
        ...prev,
        [name]: value
      }));
    }
    setValidationError(null);
  };

  const validateRequiredParameters = () => {
    const missingParams = tool.parameters?.required?.filter(param => {
      const value = parameters[param];
      return value === undefined || value === null || value === '';
    }) || [];

    if (missingParams.length > 0) {
      setValidationError(`Please fill in all required parameters: ${missingParams.join(', ')}`);
      return false;
    }
    return true;
  };

  const handleCopy = async (type: 'request' | 'response') => {
    const textToCopy = type === 'request' 
      ? JSON.stringify({ name: tool.id, arguments: parameters }, null, 2)
      : (typeof response === 'string' ? response : JSON.stringify(response, null, 2));

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleTest = async () => {
    setValidationError(null);
    if (!validateRequiredParameters()) return;
    
    // Collapse both sections
    setShowInputs(false);
    setShowRequest(false);
    
    setResponse(null);
    setError(null);
    setIsLoading(true);
    
    try {
      const result = await testMcpTool(projectId, server.name, tool.id, parameters);
      setResponse(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred while testing the tool');
    } finally {
      setIsLoading(false);
    }
  };

  const renderParameterInput = (paramName: string, schema: any) => {
    const value = parameters[paramName] ?? (schema.type === 'array' ? [] : schema.type === 'object' ? {} : '');
    
    switch (schema.type) {
      case 'array':
        const arrayValue = Array.isArray(value) ? value : value ? [value] : [];
        const itemSchema = schema.items || { type: 'string' };

        const handleArrayItemChange = (index: number, itemValue: any) => {
          const newArray = [...arrayValue];
          newArray[index] = itemValue;
          handleParameterChange(paramName, newArray);
        };

        return (
          <div className="space-y-2">
            {arrayValue.map((item: any, index: number) => (
              <div key={index} className="flex gap-2 items-start">
                <div className="text-sm text-gray-500 dark:text-gray-400 pt-2 min-w-[24px]">
                  {index + 1}:
                </div>
                <div className="flex-1">
                  {itemSchema.type === 'string' ? (
                    <Input
                      type="text"
                      value={item || ''}
                      onChange={(e) => handleArrayItemChange(index, e.target.value)}
                      placeholder="Enter value"
                      className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
                    />
                  ) : itemSchema.type === 'number' || itemSchema.type === 'integer' ? (
                    <Input
                      type="number"
                      value={item || ''}
                      step={itemSchema.type === 'integer' ? '1' : 'any'}
                      min={itemSchema.minimum}
                      max={itemSchema.maximum}
                      onChange={(e) => {
                        const val = itemSchema.type === 'integer' ? 
                          parseInt(e.target.value, 10) : 
                          parseFloat(e.target.value);
                        handleArrayItemChange(index, isNaN(val) ? '' : val);
                      }}
                      placeholder="Enter value"
                      className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
                    />
                  ) : itemSchema.type === 'boolean' ? (
                    <div className="scale-75 origin-left">
                      <Switch
                        checked={!!item}
                        onCheckedChange={(checked) => handleArrayItemChange(index, checked)}
                      />
                    </div>
                  ) : (
                    <div className="w-full">
                      {renderParameterInput(paramName, {
                        ...itemSchema,
                        value: item,
                        onChange: (newValue: any) => handleArrayItemChange(index, newValue)
                      })}
                    </div>
                  )}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const newArray = arrayValue.filter((_, i) => i !== index);
                    handleParameterChange(paramName, newArray);
                  }}
                  className="px-2 h-9 hover:bg-transparent border-transparent"
                >
                  <Trash2 className="h-4 w-4 text-gray-500 hover:text-red-500 transition-colors" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              onClick={() => {
                const defaultValue = itemSchema.type === 'object' ? {} : 
                                   itemSchema.type === 'array' ? [] : 
                                   itemSchema.type === 'boolean' ? false : '';
                handleParameterChange(paramName, [...arrayValue, defaultValue]);
              }}
              className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-transparent border-transparent"
            >
              Add item
            </Button>
          </div>
        );

      case 'object':
        if (!schema.properties) return null;
        const objectValue = typeof value === 'object' ? value : {};
        return (
          <div className="space-y-4 border-l-2 border-gray-200 dark:border-gray-700 pl-4 mt-2">
            {Object.entries(schema.properties).map(([key, propSchema]: [string, any]) => (
              <div key={key} className="space-y-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {key}
                  {schema.required?.includes(key) && <span className="text-red-500 ml-1">*</span>}
                </label>
                {renderParameterInput(
                  `${paramName}.${key}`,
                  propSchema
                )}
              </div>
            ))}
          </div>
        );

      case 'string':
        if (schema.enum) {
          return (
            <select
              value={value}
              onChange={(e) => handleParameterChange(paramName, e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md 
                bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                focus:outline-none hover:border-gray-300 dark:hover:border-gray-600
                focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0"
            >
              <option value="" disabled>Select {paramName}</option>
              {schema.enum.map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          );
        }
        if (schema.format === 'date-time') {
          return (
            <Input
              type="datetime-local"
              value={value}
              onChange={(e) => handleParameterChange(paramName, e.target.value)}
              className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
            />
          );
        }
        if (schema.format === 'date') {
          return (
            <Input
              type="date"
              value={value}
              onChange={(e) => handleParameterChange(paramName, e.target.value)}
              className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
            />
          );
        }
        if (schema.format === 'time') {
          return (
            <Input
              type="time"
              value={value}
              onChange={(e) => handleParameterChange(paramName, e.target.value)}
              className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
            />
          );
        }
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => handleParameterChange(paramName, e.target.value)}
            placeholder={`Enter ${paramName}`}
            className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
          />
        );
      
      case 'number':
      case 'integer':
        return (
          <Input
            type="number"
            value={value}
            step={schema.type === 'integer' ? '1' : 'any'}
            min={schema.minimum}
            max={schema.maximum}
            onChange={(e) => {
              const val = schema.type === 'integer' ? 
                parseInt(e.target.value, 10) : 
                parseFloat(e.target.value);
              handleParameterChange(paramName, isNaN(val) ? '' : val);
            }}
            placeholder={`Enter ${paramName}`}
            className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
          />
        );
      
      case 'boolean':
        return (
          <div className="scale-75 origin-left">
            <Switch
              checked={!!value}
              onCheckedChange={(checked) => handleParameterChange(paramName, checked)}
            />
          </div>
        );
      
      case 'null':
        return (
          <div className="text-sm text-gray-500 dark:text-gray-400 italic">
            Null value
          </div>
        );

      default:
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => handleParameterChange(paramName, e.target.value)}
            placeholder={`Enter ${paramName}`}
            className="focus:ring-0 focus:ring-offset-0 !ring-0 !ring-offset-0 focus:outline-none"
          />
        );
    }
  };

  const getFilteredParameters = () => {
    if (!tool.parameters?.properties) return [];
    
    return Object.entries(tool.parameters.properties).filter(([name]) => {
      if (showOnlyRequired) {
        return tool.parameters?.required?.includes(name);
      }
      return true;
    });
  };

  const formatResponse = (response: any): string => {
    try {
      if (showRawResponse) {
        return typeof response === 'string' ? response : JSON.stringify(response);
      }

      // Convert to object if it's a string
      const obj = typeof response === 'string' ? JSON.parse(response) : response;
      
      // Handle nested structures and attempt to parse JSON strings
      const processValue = (value: any): any => {
        if (typeof value === 'string') {
          try {
            // Try to parse string as JSON if it looks like JSON
            if ((value.startsWith('{') && value.endsWith('}')) || 
                (value.startsWith('[') && value.endsWith(']'))) {
              const parsed = JSON.parse(value);
              return processValue(parsed); // Recursively process the parsed JSON
            }
          } catch {
            // Not valid JSON, treat as regular string
          }
          // Preserve explicit newlines in regular strings
          return value;
        }
        if (Array.isArray(value)) {
          return value.map(processValue);
        }
        if (value && typeof value === 'object') {
          const processed: any = {};
          for (const [k, v] of Object.entries(value)) {
            processed[k] = processValue(v);
          }
          return processed;
        }
        return value;
      };

      // Process and stringify with proper indentation
      const processed = processValue(obj);
      const stringified = JSON.stringify(processed, null, 2);

      // Replace escaped newlines and handle nested JSON formatting
      return stringified
        .replace(/\\n/g, '\n')  // Convert escaped newlines to actual newlines
        .replace(/"\{/g, '{')   // Remove quotes around nested JSON objects
        .replace(/\}"/g, '}')   // Remove quotes around nested JSON objects
        .replace(/"\[/g, '[')   // Remove quotes around nested JSON arrays
        .replace(/\]"/g, ']');  // Remove quotes around nested JSON arrays
    } catch (e) {
      // If JSON parsing fails, return as is
      return String(response);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[900px] max-w-[90vw] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Test {tool.name}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6 space-y-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {tool.description}
          </div>

          {validationError && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md mb-6">
              {validationError}
            </div>
          )}

          <div className="flex flex-col flex-1 min-h-0">
            <div>
              <button
                onClick={() => setShowInputs(!showInputs)}
                className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
              >
                {showInputs ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Inputs
              </button>
              
              {showInputs && (
                <div className="space-y-6 pl-5 mt-4">
                  <div className="flex flex-col gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="scale-75 origin-left">
                        <Switch
                          checked={showOnlyRequired}
                          onCheckedChange={setShowOnlyRequired}
                        />
                      </div>
                      <label className="text-sm text-gray-700 dark:text-gray-300">
                        Show only required parameters
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="scale-75 origin-left">
                        <Switch
                          checked={showDescriptions}
                          onCheckedChange={setShowDescriptions}
                        />
                      </div>
                      <label className="text-sm text-gray-700 dark:text-gray-300">
                        Show parameter descriptions
                      </label>
                    </div>
                  </div>

                  {getFilteredParameters().map(([name, schema]) => (
                    <div key={name} className="space-y-3">
                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                          {name}
                          {tool.parameters?.required?.includes(name) && (
                            <span className="text-red-500 ml-1">*</span>
                          )}
                        </label>
                        {showDescriptions && schema.description && (
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            {schema.description}
                          </p>
                        )}
                      </div>
                      {renderParameterInput(name, schema)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md mt-6">
                {error}
              </div>
            )}

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowRequest(!showRequest)}
                  className="flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                >
                  {showRequest ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Request
                </button>
                {showRequest && (
                  <button
                    onClick={() => handleCopy('request')}
                    className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-1.5"
                    title="Copy request"
                  >
                    <Copy className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                    {copySuccess === 'request' && (
                      <span className="text-xs text-green-600 dark:text-green-400">
                        Copied!
                      </span>
                    )}
                  </button>
                )}
              </div>
              
              {showRequest && (
                <div className="pl-5 mt-4">
                  <pre className="text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded-md overflow-auto max-h-60">
                    {JSON.stringify({ name: tool.id, arguments: parameters }, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Response section - shown when loading or when there's a response */}
            {(isLoading || response) && (
              <div className="flex flex-col flex-1 min-h-0 mt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Response</h4>
                    {response && (
                      <>
                        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-gray-600 dark:text-gray-400">
                            Raw
                          </label>
                          <div className="scale-75 origin-right">
                            <Switch
                              checked={showRawResponse}
                              onCheckedChange={setShowRawResponse}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {response && (
                    <button
                      onClick={() => handleCopy('response')}
                      className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center gap-1.5"
                      title="Copy response"
                    >
                      <Copy className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                      {copySuccess === 'response' && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          Copied!
                        </span>
                      )}
                    </button>
                  )}
                </div>
                <div className="pl-5 mt-4 flex-1 min-h-0">
                  {isLoading ? (
                    <div className="h-full bg-gray-50 dark:bg-gray-800 rounded-md p-3 flex items-start">
                      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-600 dark:border-t-blue-400" />
                        Awaiting response...
                      </div>
                    </div>
                  ) : (
                    <>
                      <pre 
                        className={clsx(
                          "text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded-md overflow-auto h-full",
                          !showRawResponse && "whitespace-pre-wrap break-all"
                        )}
                      >
                        {formatResponse(response)}
                      </pre>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={isLoading}
            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 
              border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700"
          >
            <span className="text-sm">Reset</span>
          </Button>
          <Button
            variant="primary"
            onClick={handleTest}
            disabled={isLoading}
          >
            <span className="text-sm">{isLoading ? 'Awaiting...' : 'Test'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
} 
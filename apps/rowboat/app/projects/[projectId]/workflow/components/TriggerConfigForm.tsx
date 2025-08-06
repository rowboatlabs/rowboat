'use client';

import React, { useState, useCallback } from 'react';
import { Button, Input, Card, CardBody, CardHeader } from '@heroui/react';
import { ArrowLeft, ZapIcon, CheckCircleIcon } from 'lucide-react';
import { z } from 'zod';
import { ZToolkit } from '@/app/lib/composio/composio';
import { ComposioTriggerType } from '@/src/entities/models/composio-trigger-type';

interface TriggerConfigFormProps {
  toolkit: z.infer<typeof ZToolkit>;
  triggerType: z.infer<typeof ComposioTriggerType>;
  onBack: () => void;
  onSubmit: (config: Record<string, unknown>) => void;
  isSubmitting?: boolean;
}

interface JsonSchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: any;
  enum?: any[];
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  title?: string;
}

export function TriggerConfigForm({
  toolkit,
  triggerType,
  onBack,
  onSubmit,
  isSubmitting = false,
}: TriggerConfigFormProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Parse the JSON schema from triggerType.config
  const schema = triggerType.config as JsonSchema;

  const handleSubmit = useCallback(() => {
    // Validate required fields
    const newErrors: Record<string, string> = {};
    
    if (schema.required) {
      schema.required.forEach(fieldName => {
        if (!formData[fieldName] || formData[fieldName].trim() === '') {
          const field = schema.properties[fieldName];
          newErrors[fieldName] = `${field?.title || fieldName} is required`;
        }
      });
    }

    setErrors(newErrors);

    // If no errors, submit the form
    if (Object.keys(newErrors).length === 0) {
      // Convert form data to appropriate types based on schema
      const processedData: Record<string, unknown> = {};
      
      Object.entries(formData).forEach(([key, value]) => {
        const property = schema.properties[key];
        if (property) {
          switch (property.type) {
            case 'number':
            case 'integer':
              processedData[key] = value ? Number(value) : undefined;
              break;
            case 'boolean':
              processedData[key] = value === 'true';
              break;
            default:
              processedData[key] = value;
          }
        }
      });

      onSubmit(processedData);
    }
  }, [formData, schema, onSubmit]);

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    
    // Clear error for this field if it exists
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  }, [errors]);

  // Check if trigger requires configuration
  const hasConfigFields = schema && schema.properties && Object.keys(schema.properties).length > 0;

  if (!hasConfigFields) {
    // No configuration needed - show success state
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="light" isIconOnly onPress={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {triggerType.name} Configuration
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No additional configuration required
            </p>
          </div>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <ZapIcon className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                <CheckCircleIcon className="w-4 h-4 text-white" />
              </div>
            </div>
          </div>
          
          <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Ready to Create Trigger!
          </h3>
          
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            This trigger type doesn&apos;t require additional configuration. You can create it directly.
          </p>

          <Button
            color="primary"
            size="lg"
            onPress={() => onSubmit({})}
            isLoading={isSubmitting}
          >
            {isSubmitting ? 'Creating Trigger...' : 'Create Trigger'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="light" isIconOnly onPress={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Configure {triggerType.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {triggerType.description}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h4 className="text-base font-medium text-gray-900 dark:text-gray-100">
            Trigger Configuration
          </h4>
        </CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Configure the settings for your {toolkit.name} trigger:
            </div>
            
            <div className="space-y-4">
              {Object.entries(schema.properties).map(([fieldName, property]) => {
                const isRequired = schema.required?.includes(fieldName) || false;
                const fieldValue = formData[fieldName] || '';
                const fieldError = errors[fieldName];

                // Handle different input types based on property type
                if (property.enum) {
                  // Render select for enum fields
                  return (
                    <div key={fieldName}>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {property.title || fieldName}
                        {isRequired && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      <select
                        value={fieldValue}
                        onChange={(e) => handleFieldChange(fieldName, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
                          bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                          focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                        required={isRequired}
                      >
                        <option value="">Select {property.title || fieldName}</option>
                        {property.enum.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      {property.description && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {property.description}
                        </p>
                      )}
                      {fieldError && (
                        <p className="mt-1 text-xs text-red-500">{fieldError}</p>
                      )}
                    </div>
                  );
                }

                return (
                  <Input
                    key={fieldName}
                    label={property.title || fieldName}
                    placeholder={property.description || `Enter ${property.title || fieldName}`}
                    value={fieldValue}
                    onValueChange={(value) => handleFieldChange(fieldName, value)}
                    isRequired={isRequired}
                    type={property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                    variant="bordered"
                    description={property.description}
                    isInvalid={!!fieldError}
                    errorMessage={fieldError}
                  />
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end gap-3">
        <Button
          variant="bordered"
          onPress={onBack}
          isDisabled={isSubmitting}
        >
          Back
        </Button>
        <Button
          color="primary"
          onPress={handleSubmit}
          isLoading={isSubmitting}
        >
          {isSubmitting ? 'Creating Trigger...' : 'Create Trigger'}
        </Button>
      </div>
    </div>
  );
}
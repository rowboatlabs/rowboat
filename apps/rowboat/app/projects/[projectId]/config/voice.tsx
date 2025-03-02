'use client';

import { useState, useEffect } from 'react';
import { Button } from "@nextui-org/react";
import { configureTwilioNumber, mockConfigureTwilioNumber, getTwilioConfigs, deleteTwilioConfig } from "../../../actions/voice_actions";
import { PhoneIcon } from "lucide-react";
import { FormSection } from "../../../lib/components/form-section";
import { EditableField } from "../../../lib/components/editable-field";
import { StructuredPanel } from "../../../lib/components/structured-panel";
import { TwilioConfig } from "../../../lib/types/voice_types";
import { CheckCircleIcon, XCircleIcon, InfoIcon } from "lucide-react";

export function VoiceSection({
    projectId,
}: {
    projectId: string;
}) {
    const [formState, setFormState] = useState({
        phone: '',
        accountSid: '',
        authToken: '',
        label: ''
    });
    const [existingConfig, setExistingConfig] = useState<TwilioConfig | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [configurationValid, setConfigurationValid] = useState(false);

    const loadConfig = async () => {
        try {
            const configs = await getTwilioConfigs(projectId);
            if (configs.length > 0) {
                const config = configs[0];
                setExistingConfig(config);
                setFormState({
                    phone: config.phone_number,
                    accountSid: config.account_sid,
                    authToken: config.auth_token,
                    label: config.label || ''
                });
            }
        } catch (err) {
            console.error('Error loading config:', err);
        }
    };

    useEffect(() => {
        loadConfig();
    }, [projectId]);

    const handleFieldChange = (field: string, value: string) => {
        setFormState(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const handleConfigureTwilio = async () => {
        const { phone, accountSid, authToken, label } = formState;

        if (!phone || !accountSid || !authToken) {
            setError('Please fill in all required fields');
            setConfigurationValid(false);
            return;
        }

        const workflowId = localStorage.getItem(`lastWorkflowId_${projectId}`);
        if (!workflowId) {
            setError('No workflow selected. Please select a workflow first.');
            setConfigurationValid(false);
            return;
        }

        setLoading(true);
        setError(null);

        const configParams = {
            phone_number: phone,
            account_sid: accountSid,
            auth_token: authToken,
            label: label,
            project_id: projectId,
            workflow_id: workflowId,
        };

        if (existingConfig) {
            await deleteTwilioConfig(projectId, existingConfig._id.toString());
        }

        const result = await mockConfigureTwilioNumber(configParams);

        if (result.success) {
            await loadConfig();
            setSuccess(true);
            setConfigurationValid(true);
            setTimeout(() => setSuccess(false), 3000);
        } else {
            setError(result.error || 'Failed to configure Twilio');
            setConfigurationValid(false);
        }
        
        setLoading(false);
    };

    const handleDeleteConfig = async () => {
        if (!existingConfig) return;
        
        if (confirm('Are you sure you want to delete this phone number configuration?')) {
            await deleteTwilioConfig(projectId, existingConfig._id.toString());
            setExistingConfig(null);
            setFormState({
                phone: '',
                accountSid: '',
                authToken: '',
                label: ''
            });
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <StructuredPanel title="CONFIGURE TWILIO PHONE NUMBER">
                <div className="flex flex-col gap-4 p-6">
                    {/* Success Message */}
                    {success && (
                        <div className="bg-green-50 text-green-700 p-4 rounded-md flex items-center gap-2">
                            <CheckCircleIcon className="w-5 h-5" />
                            <span>
                                {existingConfig 
                                    ? 'Twilio number updated successfully!'
                                    : 'Twilio number configured successfully!'}
                            </span>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-md flex items-center gap-2">
                            <XCircleIcon className="w-5 h-5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Current Configuration Banner - show only when config is valid and no errors */}
                    {existingConfig && configurationValid && !error && (
                        <div className="bg-blue-50 text-blue-700 p-4 rounded-md flex items-center gap-2">
                            <InfoIcon className="w-5 h-5" />
                            <span>This is your currently assigned phone number for this project</span>
                        </div>
                    )}

                    <FormSection label="TWILIO PHONE NUMBER">
                        <EditableField
                            value={formState.phone}
                            onChange={(value) => handleFieldChange('phone', value)}
                            placeholder="+14156021922"
                            disabled={loading}
                        />
                    </FormSection>

                    <FormSection label="TWILIO ACCOUNT SID">
                        <EditableField
                            value={formState.accountSid}
                            onChange={(value) => handleFieldChange('accountSid', value)}
                            placeholder="AC5588686d3ec65df89615274..."
                            disabled={loading}
                        />
                    </FormSection>

                    <FormSection label="TWILIO AUTH TOKEN">
                        <EditableField
                            value={formState.authToken}
                            onChange={(value) => handleFieldChange('authToken', value)}
                            placeholder="b74e48f9098764ef834cf6bd..."
                            type="password"
                            disabled={loading}
                        />
                    </FormSection>

                    <FormSection label="LABEL">
                        <EditableField
                            value={formState.label}
                            onChange={(value) => handleFieldChange('label', value)}
                            placeholder="home"
                            disabled={loading}
                        />
                    </FormSection>

                    <div className="flex gap-2 mt-4">
                        <Button
                            color="primary"
                            onClick={handleConfigureTwilio}
                            isLoading={loading}
                            disabled={loading}
                        >
                            {existingConfig ? 'Update Twilio Config' : 'Import from Twilio'}
                        </Button>
                        {existingConfig ? (
                            <Button
                                color="danger"
                                variant="flat"
                                onClick={handleDeleteConfig}
                                disabled={loading}
                            >
                                Delete Configuration
                            </Button>
                        ) : (
                            <Button
                                variant="flat"
                                onClick={() => {
                                    setFormState({
                                        phone: '',
                                        accountSid: '',
                                        authToken: '',
                                        label: ''
                                    });
                                    setError(null);
                                }}
                                disabled={loading}
                            >
                                Cancel
                            </Button>
                        )}
                    </div>
                </div>
            </StructuredPanel>
        </div>
    );
}

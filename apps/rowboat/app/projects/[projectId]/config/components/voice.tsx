'use client';

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { configureTwilioNumber, getTwilioConfigs, deleteTwilioConfig } from "../../../../actions/voice_actions";
import { TwilioConfig, TwilioConfigParams } from "../../../../lib/types/voice_types";
import { CheckCircleIcon, XCircleIcon, InfoIcon, EyeOffIcon, EyeIcon } from "lucide-react";
import { Section } from './project';
import { clsx } from 'clsx';
import { WithStringId } from "../../../../lib/types/types";
import { z } from 'zod';

function PhoneNumberSection({ 
    value, 
    onChange, 
    disabled 
}: { 
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
}) {
    return (
        <Section
            title="Twilio Phone Number"
            description="The phone number to use for voice calls."
        >
            <div className="space-y-2">
                <div className={clsx(
                    "border rounded-lg focus-within:ring-2",
                    "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                )}>
                    <Textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="+14156021922"
                        className="w-full text-sm bg-transparent border-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                        disabled={disabled}
                        autoResize
                    />
                </div>
            </div>
        </Section>
    );
}

function AccountSidSection({ 
    value, 
    onChange, 
    disabled 
}: { 
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
}) {
    return (
        <Section
            title="Twilio Account SID"
            description="Your Twilio account identifier."
        >
            <div className="space-y-2">
                <div className={clsx(
                    "border rounded-lg focus-within:ring-2",
                    "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                )}>
                    <Textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="AC5588686d3ec65df89615274..."
                        className="w-full text-sm bg-transparent border-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                        disabled={disabled}
                        autoResize
                    />
                </div>
            </div>
        </Section>
    );
}

function AuthTokenSection({ 
    value, 
    onChange, 
    disabled 
}: { 
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
}) {
    return (
        <Section
            title="Twilio Auth Token"
            description="Your Twilio authentication token."
        >
            <div className="space-y-2">
                <div className={clsx(
                    "border rounded-lg focus-within:ring-2",
                    "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                )}>
                    <Textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="b74e48f9098764ef834cf6bd..."
                        className="w-full text-sm bg-transparent border-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                        disabled={disabled}
                        autoResize
                    />
                </div>
            </div>
        </Section>
    );
}

function LabelSection({ 
    value, 
    onChange, 
    disabled 
}: { 
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
}) {
    return (
        <Section
            title="Label"
            description="A descriptive label for this phone number configuration."
        >
            <div className="space-y-2">
                <div className={clsx(
                    "border rounded-lg focus-within:ring-2",
                    "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                )}>
                    <Textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Enter a label for this number..."
                        className="w-full text-sm bg-transparent border-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                        disabled={disabled}
                        autoResize
                    />
                </div>
            </div>
        </Section>
    );
}

export function VoiceSection({ projectId }: { projectId: string }) {
    const [formState, setFormState] = useState({
        phone: '',
        accountSid: '',
        authToken: '',
        label: ''
    });
    const [existingConfig, setExistingConfig] = useState<WithStringId<z.infer<typeof TwilioConfig>> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [configurationValid, setConfigurationValid] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    const loadConfig = useCallback(async () => {
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
                setConfigurationValid(true);
                setIsDirty(false);
            }
        } catch (err) {
            console.error('Error loading config:', err);
        }
    }, [projectId]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const handleFieldChange = (field: string, value: string) => {
        setFormState(prev => ({
            ...prev,
            [field]: value
        }));
        setIsDirty(true);
        setError(null);
    };

    const handleConfigureTwilio = async () => {
        if (!formState.phone || !formState.accountSid || !formState.authToken) {
            setError('Please fill in all required fields');
            setConfigurationValid(false);
            return;
        }

        setLoading(true);
        setError(null);

        const configParams: z.infer<typeof TwilioConfigParams> = {
            phone_number: formState.phone.replaceAll(/[^0-9\+]/g, ''),
            account_sid: formState.accountSid,
            auth_token: formState.authToken,
            label: formState.label,
            project_id: projectId,
        };

        const result = await configureTwilioNumber(configParams);

        if (result.success) {
            await loadConfig();
            setSuccess(true);
            setConfigurationValid(true);
            setIsDirty(false);
            setTimeout(() => setSuccess(false), 3000);
        } else {
            setError(result.error || 'Failed to validate Twilio credentials or phone number');
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
            setConfigurationValid(false);
            setIsDirty(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
                    {success && (
                        <div className="bg-green-50 text-green-700 p-4 rounded-md flex items-center gap-2">
                            <CheckCircleIcon className="w-5 h-5" />
                            <span>
                                {existingConfig 
                                    ? 'Twilio number validated and updated successfully!'
                                    : 'Twilio number validated and configured successfully!'}
                            </span>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-md flex items-center gap-2">
                            <XCircleIcon className="w-5 h-5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {existingConfig && configurationValid && !error && (
                        <div className="bg-blue-50 text-blue-700 p-4 rounded-md flex items-center gap-2">
                            <InfoIcon className="w-5 h-5" />
                            <span>This is your currently assigned phone number for this project</span>
                        </div>
                    )}

            <PhoneNumberSection
                            value={formState.phone}
                            onChange={(value) => handleFieldChange('phone', value)}
                            disabled={loading}
                        />

            <AccountSidSection
                            value={formState.accountSid}
                            onChange={(value) => handleFieldChange('accountSid', value)}
                            disabled={loading}
                        />

            <AuthTokenSection
                            value={formState.authToken}
                            onChange={(value) => handleFieldChange('authToken', value)}
                            disabled={loading}
                        />

            <LabelSection
                            value={formState.label}
                            onChange={(value) => handleFieldChange('label', value)}
                            disabled={loading}
                        />

            <div className="flex gap-2">
                        <Button
                    variant="primary"
                    size="sm"
                            onClick={handleConfigureTwilio}
                            disabled={loading || !isDirty}
                        >
                            {existingConfig ? 'Update Twilio Config' : 'Import from Twilio'}
                        </Button>
                        {existingConfig && (
                            <Button
                        variant="primary"
                        color="red"
                        size="sm"
                                onClick={handleDeleteConfig}
                                disabled={loading}
                            >
                                Delete Configuration
                            </Button>
                        )}
                    </div>
        </div>
    );
}

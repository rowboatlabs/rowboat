'use server';

import { TwilioConfigParams, TwilioConfigResponse, TwilioConfig, InboundConfigResponse } from "../lib/types/voice_types";
import { twilioConfigsCollection } from "../lib/mongodb";
import { ObjectId } from "mongodb";
import twilio from 'twilio';
import { Twilio } from 'twilio';

// Helper function to serialize MongoDB documents
function serializeConfig(config: any) {
    return {
        ...config,
        _id: config._id.toString(),
        createdAt: config.createdAt.toISOString(),
    };
}

// Real implementation for configuring Twilio number
export async function configureTwilioNumber(params: TwilioConfigParams): Promise<TwilioConfigResponse> {
    console.log('configureTwilioNumber - Received params:', params);
    try {
        const client = twilio(params.account_sid, params.auth_token);
        
        try {
            // List all phone numbers and find the matching one
            const numbers = await client.incomingPhoneNumbers.list();
            console.log('Twilio numbers for this account:', numbers);
            const phoneExists = numbers.some(
                number => number.phoneNumber === params.phone_number
            );
            
            if (!phoneExists) {
                throw new Error('Phone number not found in this account');
            }
        } catch (error) {
            console.error('Error verifying phone number:', error);
            throw new Error(
                error instanceof Error 
                    ? error.message 
                    : 'Invalid phone number or phone number does not belong to this account'
            );
        }

        // Save to MongoDB after successful validation
        const savedConfig = await saveTwilioConfig(params);
        console.log('configureTwilioNumber - Saved config result:', savedConfig);

        return { success: true };
    } catch (error) {
        console.error('Error in configureTwilioNumber:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to configure Twilio number'
        };
    }
}

// Save Twilio configuration to MongoDB
export async function saveTwilioConfig(params: TwilioConfigParams): Promise<TwilioConfig> {
    console.log('saveTwilioConfig - Incoming params:', {
        ...params,
        label: {
            value: params.label,
            type: typeof params.label,
            length: params.label?.length,
            isEmpty: params.label === ''
        }
    });
    
    // First, list all configs to see what's in the database
    const allConfigs = await twilioConfigsCollection
        .find({ status: 'active' as const })
        .toArray();
    console.log('saveTwilioConfig - All active configs in DB:', allConfigs);

    // Find existing config for this project
    const existingConfig = await twilioConfigsCollection.findOne({
        project_id: params.project_id,
        status: 'active' as const
    });
    console.log('saveTwilioConfig - Existing config search by project:', {
        searchCriteria: {
            project_id: params.project_id,
            status: 'active'
        },
        found: existingConfig
    });

    const configToSave = {
        phone_number: params.phone_number,
        account_sid: params.account_sid,
        auth_token: params.auth_token,
        label: params.label || '',  // Use empty string instead of undefined
        project_id: params.project_id,
        workflow_id: params.workflow_id,
        createdAt: existingConfig?.createdAt || new Date(),
        status: 'active' as const
    };
    console.log('saveTwilioConfig - Config to save:', configToSave);

    try {
        // Configure inbound calls first
        await configureInboundCall(
            params.phone_number,
            params.account_sid,
            params.auth_token,
            params.workflow_id
        );

        // Then save/update the config in database
        if (existingConfig) {
            console.log('saveTwilioConfig - Updating existing config:', existingConfig._id);
            const result = await twilioConfigsCollection.updateOne(
                { _id: existingConfig._id },
                { $set: configToSave }
            );
            console.log('saveTwilioConfig - Update result:', result);
        } else {
            console.log('saveTwilioConfig - No existing config found, creating new');
            const result = await twilioConfigsCollection.insertOne(configToSave);
            console.log('saveTwilioConfig - Insert result:', result);
        }

        const savedConfig = await twilioConfigsCollection.findOne({
            project_id: params.project_id,
            status: 'active'
        });

        if (!savedConfig) {
            throw new Error('Failed to save Twilio configuration');
        }

        console.log('configureTwilioNumber - Saved config result:', savedConfig);
        return savedConfig;

    } catch (error) {
        console.error('Error saving Twilio config:', error);
        throw error;
    }
}

// Get Twilio configuration for a workflow
export async function getTwilioConfigs(projectId: string) {
    console.log('getTwilioConfigs - Fetching for projectId:', projectId);
    const configs = await twilioConfigsCollection
        .find({ 
            project_id: projectId,
            status: 'active' as const
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
    
    console.log('getTwilioConfigs - Raw configs:', configs);
    const serializedConfigs = configs.map(serializeConfig);
    console.log('getTwilioConfigs - Serialized configs:', serializedConfigs);
    return serializedConfigs;
}

// Delete a Twilio configuration (soft delete)
export async function deleteTwilioConfig(projectId: string, configId: string) {
    console.log('deleteTwilioConfig - Deleting config:', { projectId, configId });
    const result = await twilioConfigsCollection.updateOne(
        {
            _id: new ObjectId(configId),
            project_id: projectId
        },
        {
            $set: { status: 'deleted' as const }
        }
    );
    console.log('deleteTwilioConfig - Delete result:', result);
    return result;
}

// Mock implementation for testing/development
export async function mockConfigureTwilioNumber(params: TwilioConfigParams): Promise<TwilioConfigResponse> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await saveTwilioConfig(params);
    return { success: true };
}

export async function configureInboundCall(
    phone_number: string,
    account_sid: string,
    auth_token: string,
    workflow_id: string
): Promise<InboundConfigResponse> {
    try {
        // Normalize phone number format
        if (!phone_number.startsWith('+')) {
            phone_number = '+' + phone_number;
        }

        console.log('Configuring inbound call for:', {
            phone_number,
            workflow_id
        });

        // Initialize Twilio client
        const client = new Twilio(account_sid, auth_token);

        // Find the phone number in Twilio account
        const incomingPhoneNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: phone_number });
        console.log('Found Twilio numbers:', incomingPhoneNumbers.map(n => ({
            phoneNumber: n.phoneNumber,
            currentVoiceUrl: n.voiceUrl,
            currentStatusCallback: n.statusCallback,
            sid: n.sid
        })));

        if (!incomingPhoneNumbers.length) {
            throw new Error(`Phone number ${phone_number} not found in Twilio account`);
        }

        const phoneSid = incomingPhoneNumbers[0].sid;
        const currentVoiceUrl = incomingPhoneNumbers[0].voiceUrl;
        const wasPreviouslyConfigured = Boolean(currentVoiceUrl);

        // Get base URL from environment - MUST be a public URL
        const baseUrl = process.env.VOICE_API_URL;
        if (!baseUrl) {
            throw new Error('Voice service URL not configured. Please set VOICE_API_URL environment variable.');
        }

        // Validate URL is not localhost
        if (baseUrl.includes('localhost')) {
            throw new Error('Voice service must use a public URL, not localhost.');
        }

        const inboundUrl = `${baseUrl}/inbound?workflow_id=${workflow_id}`;
        console.log('Setting up webhooks:', {
            voiceUrl: inboundUrl,
            statusCallback: `${baseUrl}/call-status`,
            currentConfig: {
                voiceUrl: currentVoiceUrl,
                statusCallback: incomingPhoneNumbers[0].statusCallback
            }
        });

        // Update the phone number configuration
        const updatedNumber = await client.incomingPhoneNumbers(phoneSid).update({
            voiceUrl: inboundUrl,
            voiceMethod: 'POST',
            statusCallback: `${baseUrl}/call-status`,
            statusCallbackMethod: 'POST'
        });

        console.log('Webhook configuration complete:', {
            phoneNumber: updatedNumber.phoneNumber,
            newVoiceUrl: updatedNumber.voiceUrl,
            newStatusCallback: updatedNumber.statusCallback,
            success: updatedNumber.voiceUrl === inboundUrl
        });

        return {
            status: wasPreviouslyConfigured ? 'reconfigured' : 'configured',
            phone_number: phone_number,
            workflow_id: workflow_id,
            previous_webhook: wasPreviouslyConfigured ? currentVoiceUrl : undefined
        };

    } catch (err: unknown) {
        console.error('Error configuring inbound call:', err);
        
        // Type guard for error with message property
        if (err instanceof Error) {
            if (err.message.includes('localhost')) {
                throw new Error('Voice service needs to be accessible from the internet. Please check your configuration.');
            }
            // Type guard for Twilio error
            if ('code' in err && err.code === 21402) {
                throw new Error('Invalid voice service URL. Please make sure it\'s a public, secure URL.');
            }
        }
        
        // If we can't determine the specific error, throw a generic one
        throw new Error('Failed to configure phone number. Please check your settings and try again.');
    }
}
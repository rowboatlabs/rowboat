'use server';

import { TwilioConfigParams, TwilioConfigResponse } from "../lib/types/voice_types";
import { twilioConfigsCollection } from "../lib/mongodb";
import { ObjectId } from "mongodb";

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
    try {
        const response = await fetch(`/api/inbound-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to configure Twilio');
        }

        // Save to MongoDB after successful configuration
        await saveTwilioConfig(params);

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to configure Twilio number'
        };
    }
}

// Save Twilio configuration to MongoDB
async function saveTwilioConfig(params: TwilioConfigParams) {
    console.log('Saving config with params:', {
        ...params,
        label: params.label, // Remove the quotes
    });
    
    // Ensure label is never undefined
    const configToSave = {
        ...params,
        createdAt: new Date(),
        status: 'active' as const // Explicitly type as 'active' literal
    };

    // First, delete any existing config for this workflow
    await twilioConfigsCollection.deleteMany({
        workflow_id: params.workflow_id,
        status: 'active' as const
    });

    // Then save the new config
    const result = await twilioConfigsCollection.insertOne(configToSave);

    // Verify and serialize the saved document
    const savedConfig = await twilioConfigsCollection.findOne({ _id: result.insertedId });
    const serializedConfig = savedConfig ? serializeConfig(savedConfig) : null;
    console.log('Saved config with label:', savedConfig?.label);
    
    return serializedConfig;
}

// Get Twilio configuration for a workflow
export async function getTwilioConfigs(projectId: string) {
    const configs = await twilioConfigsCollection
        .find({ 
            project_id: projectId,
            status: 'active' as const
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
    
    // Log the raw configs before serialization
    console.log('Raw configs from DB:', configs);
    
    const serializedConfigs = configs.map(serializeConfig);
    console.log('Serialized configs:', serializedConfigs);
    return serializedConfigs;
}

// Delete a Twilio configuration (soft delete)
export async function deleteTwilioConfig(projectId: string, configId: string) {
    await twilioConfigsCollection.updateOne(
        {
            _id: new ObjectId(configId),
            project_id: projectId
        },
        {
            $set: { status: 'deleted' as const }
        }
    );
}

// Mock implementation for testing/development
export async function mockConfigureTwilioNumber(params: TwilioConfigParams): Promise<TwilioConfigResponse> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await saveTwilioConfig(params);
    return { success: true };
}

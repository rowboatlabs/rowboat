'use server';

import { TwilioConfigParams, TwilioConfigResponse } from "../lib/types/voice_types";

// Real implementation
export async function configureTwilioNumber(params: TwilioConfigParams): Promise<TwilioConfigResponse> {
    try {
        const response = await fetch(`${process.env.VOICE_API_URL}/api/inbound-config`, {
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

        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to configure Twilio number'
        };
    }
}

// Mock implementation for testing/development
export async function mockConfigureTwilioNumber(params: TwilioConfigParams): Promise<TwilioConfigResponse> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Validate phone number format (E.164)
    if (!params.phone_number.match(/^\+[1-9]\d{1,14}$/)) {
        return {
            success: false,
            error: "Invalid phone number format. Must be in E.164 format (e.g., +14156021922)"
        };
    }

    // Validate Account SID format
    if (!params.account_sid.match(/^AC[0-9a-fA-F]{32}$/)) {
        return {
            success: false,
            error: "Invalid Account SID format. Must start with 'AC' followed by 32 hexadecimal characters"
        };
    }

    // Validate Auth Token length (should be 32 characters)
    if (params.auth_token.length !== 32) {
        return {
            success: false,
            error: "Invalid Auth Token format. Must be 32 characters long"
        };
    }

    // Simulate different response scenarios
    const scenarios = [
        { probability: 0.8, response: { success: true } },
        { 
            probability: 0.1, 
            response: { 
                success: false, 
                error: "Failed to authenticate with Twilio. Please check your credentials." 
            }
        },
        { 
            probability: 0.1, 
            response: { 
                success: false, 
                error: "This phone number is not available or already in use." 
            }
        }
    ];

    // Randomly select a scenario based on probability
    const random = Math.random();
    let cumulativeProbability = 0;
    
    for (const scenario of scenarios) {
        cumulativeProbability += scenario.probability;
        if (random <= cumulativeProbability) {
            return scenario.response;
        }
    }

    // Default success case
    return { success: true };
}

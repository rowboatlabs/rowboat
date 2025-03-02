export interface TwilioConfigParams {
    phone_number: string;
    account_sid: string;
    auth_token: string;
    label: string;
    project_id: string;
    workflow_id: string;
}

export interface TwilioConfigResponse {
    success: boolean;
    error?: string;
}

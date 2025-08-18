import { getResponse } from "@/app/lib/agents";
import { twilioConfigsCollection, twilioInboundCallsCollection } from "@/app/lib/mongodb";
import { PrefixLogger } from "@/app/lib/utils";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { z } from "zod";
import { TwilioInboundCall } from "@/app/lib/types/voice_types";
import { hangup, reject, XmlResponse, ZStandardRequestParams } from "../utils";

export async function POST(request: Request) {
    let logger = new PrefixLogger("twilioInboundCall");
    logger.log("Received inbound call request");
    const recvdAt = new Date();

    /*
    form data example
    ...
    {
        Called: '+1571XXXXXXX',
        ToState: 'VA',
        CallerCountry: 'IN',
        Direction: 'inbound',
        CallerState: 'PXXXXXXX',
        ToZip: '',
        CallSid: 'CA...b0',
        To: '+1571XXXXXXX',
        CallerZip: '',
        ToCountry: 'US',
        StirVerstat: 'TN-Validation-Passed-C',
        CallToken: '%7B...',
        CalledZip: '',
        ApiVersion: '2010-04-01',
        CalledCity: '',
        CallStatus: 'ringing',
        From: '+919XXXXXXXXX',
        AccountSid: 'A....1c',
        CalledCountry: 'US',
        CallerCity: '',
        ToCity: '',
        FromCountry: 'IN',
        Caller: '+919XXXXXXXXX'
        FromCity: '',
        CalledState: 'VA',
        FromZip: '',
        FromState: 'PXXXXXXX'
    }
    */
    // parse and validate form data
    const formData = await request.formData();
    logger.log('request body:', JSON.stringify(Object.fromEntries(formData)));
    const data = ZStandardRequestParams.parse(Object.fromEntries(formData));
    logger = logger.child(data.To);

    // get a matching twilio config for this phone number.
    // if not found, reject the call
    const twilioConfig = await twilioConfigsCollection.findOne({
        phone_number: data.To,
        status: 'active',
    });
    if (!twilioConfig) {
        logger.log('No active twilio config found for this phone number');
        return reject('rejected');
    }

    // fetch project and extract live workflow
    // if workflow not found, reject the call
    const projectId = twilioConfig.project_id;
    // const project = await projectsCollection.findOne({
    //     _id: projectId,
    // });
    const project = null;
    if (!project) {
        logger.log(`Project ${projectId} not found`);
        return reject('rejected');
    }
    const workflow = project.liveWorkflow;
    if (!workflow) {
        logger.log(`Workflow not found for project ${projectId}`);
        return reject('rejected');
    }

    // this is the first turn, get the initial assistant response
    // and validate it
    const { messages } = await getResponse(projectId, workflow, []);
    if (messages.length === 0) {
        logger.log('Agent response is empty');
        return hangup();
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant' || !lastMessage.content) {
        logger.log('Invalid last message');
        return hangup();
    }

    // save call state
    const call: z.infer<typeof TwilioInboundCall> = {
        callSid: data.CallSid,
        to: data.To,
        from: data.From,
        projectId,
        messages,
        createdAt: recvdAt.toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
    await twilioInboundCallsCollection.insertOne(call);

    // speak out response
    const response = new VoiceResponse();
    response.say(lastMessage.content);
    response.gather({
        input: ['speech'],
        speechTimeout: 'auto',
        language: 'en-US',
        enhanced: true,
        speechModel: 'phone_call',
        action: `/api/twilio/turn/${data.CallSid}`,
    });
    return XmlResponse(response);
}
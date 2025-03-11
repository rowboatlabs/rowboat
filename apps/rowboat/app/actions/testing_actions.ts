'use server';
import { ObjectId } from "mongodb";
import { testScenariosCollection, testSimulationsCollection, testProfilesCollection, testRunsCollection, testResultsCollection, projectsCollection } from "../lib/mongodb";
import { z } from 'zod';
import { projectAuthCheck } from "./project_actions";
import { type WithStringId } from "../lib/types/types";
import { TestScenario, TestSimulation, TestProfile, TestRun, TestResult } from "../lib/types/testing_types";

export async function listScenarios(
    projectId: string,
    page: number = 1,
    pageSize: number = 10
): Promise<{
    scenarios: WithStringId<z.infer<typeof TestScenario>>[];
    total: number;
}> {
    await projectAuthCheck(projectId);

    // Calculate skip value for pagination
    const skip = (page - 1) * pageSize;

    // Get total count for pagination
    const total = await testScenariosCollection.countDocuments({ projectId });

    // Get paginated scenarios
    const scenarios = await testScenariosCollection
        .find({ projectId })
        .skip(skip)
        .limit(pageSize)
        .toArray();

    return {
        scenarios: scenarios.map(scenario => ({
            ...scenario,
            _id: scenario._id.toString(),
        })),
        total,
    };
}

export async function getScenario(projectId: string, scenarioId: string): Promise<WithStringId<z.infer<typeof TestScenario>> | null> {
    await projectAuthCheck(projectId);

    // fetch scenario
    const scenario = await testScenariosCollection.findOne({
        _id: new ObjectId(scenarioId),
        projectId,
    });
    if (!scenario) {
        return null;
    }
    const { _id, ...rest } = scenario;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function deleteScenario(projectId: string, scenarioId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await testScenariosCollection.deleteOne({
        _id: new ObjectId(scenarioId),
        projectId,
    });
}

export async function createScenario(
    projectId: string,
    data: {
        name: string;
        description: string;
    }
): Promise<WithStringId<z.infer<typeof TestScenario>>> {
    await projectAuthCheck(projectId);

    const doc = {
        ...data,
        projectId,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
    const result = await testScenariosCollection.insertOne(doc);
    return {
        ...doc,
        _id: result.insertedId.toString(),
    };
}

export async function updateScenario(
    projectId: string,
    scenarioId: string,
    updates: {
        name?: string;
        description?: string;
    }
): Promise<void> {
    await projectAuthCheck(projectId);

    const updateData: any = {
        ...updates,
        lastUpdatedAt: new Date().toISOString(),
    };

    await testScenariosCollection.updateOne(
        {
            _id: new ObjectId(scenarioId),
            projectId,
        },
        {
            $set: updateData,
        }
    );
}

export async function listSimulations(
    projectId: string,
    page: number = 1,
    pageSize: number = 10
): Promise<{
    simulations: WithStringId<z.infer<typeof TestSimulation>>[];
    total: number;
}> {
    await projectAuthCheck(projectId);
    const skip = (page - 1) * pageSize;
    const total = await testSimulationsCollection.countDocuments({ projectId });
    
    const simulations = await testSimulationsCollection
        .find({ projectId })
        .skip(skip)
        .limit(pageSize)
        .toArray();

    return {
        simulations: simulations.map(simulation => ({
            ...simulation,
            _id: simulation._id.toString(),
        })),
        total,
    };
}

export async function getSimulation(projectId: string, simulationId: string): Promise<WithStringId<z.infer<typeof TestSimulation>> | null> {
    await projectAuthCheck(projectId);
    
    const simulation = await testSimulationsCollection.findOne({
        _id: new ObjectId(simulationId),
        projectId,
    });
    if (!simulation) {
        return null;
    }
    const { _id, ...rest } = simulation;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function deleteSimulation(projectId: string, simulationId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await testSimulationsCollection.deleteOne({
        _id: new ObjectId(simulationId),
        projectId,
    });
}

export async function createSimulation(
    projectId: string,
    data: {
        name: string;
        description?: string;
        scenarioId: string;
        profileId: string | null;
        passCriteria: string;
    }
): Promise<WithStringId<z.infer<typeof TestSimulation>>> {
    await projectAuthCheck(projectId);

    const doc: z.infer<typeof TestSimulation> = {
        ...data,
        projectId,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
    const result = await testSimulationsCollection.insertOne(doc);
    return {
        ...doc,
        _id: result.insertedId.toString(),
    };
}

export async function updateSimulation(
    projectId: string,
    simulationId: string,
    updates: {
        name?: string;
        description?: string;
        scenarioId?: string;
        profileId?: string | null;
        passCriteria?: string;
    }
): Promise<void> {
    await projectAuthCheck(projectId);

    const updateData: any = {
        ...updates,
        lastUpdatedAt: new Date().toISOString(),
    };

    await testSimulationsCollection.updateOne(
        {
            _id: new ObjectId(simulationId),
            projectId,
        },
        {
            $set: updateData,
        }
    );
}

export async function listProfiles(
    projectId: string,
    page: number = 1,
    pageSize: number = 10
): Promise<{
    profiles: WithStringId<z.infer<typeof TestProfile>>[];
    total: number;
}> {
    await projectAuthCheck(projectId);
    const skip = (page - 1) * pageSize;
    const total = await testProfilesCollection.countDocuments({ projectId });
    
    const profiles = await testProfilesCollection
        .find({ projectId })
        .skip(skip)
        .limit(pageSize)
        .toArray();

    return {
        profiles: profiles.map(profile => ({
            ...profile,
            _id: profile._id.toString(),
        })),
        total,
    };
}

export async function getProfile(projectId: string, profileId: string): Promise<WithStringId<z.infer<typeof TestProfile>> | null> {
    await projectAuthCheck(projectId);
    
    const profile = await testProfilesCollection.findOne({
        _id: new ObjectId(profileId),
        projectId,
    });
    if (!profile) {
        return null;
    }
    const { _id, ...rest } = profile;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function deleteProfile(projectId: string, profileId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await testProfilesCollection.deleteOne({
        _id: new ObjectId(profileId),
        projectId,
    });
}

export async function createProfile(
    projectId: string,
    data: {
        name: string;
        context: string;
        mockTools: boolean;
        mockPrompt?: string;
    }
): Promise<WithStringId<z.infer<typeof TestProfile>>> {
    await projectAuthCheck(projectId);

    const doc = {
        ...data,
        projectId,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
    const result = await testProfilesCollection.insertOne(doc);
    return {
        ...doc,
        _id: result.insertedId.toString(),
    };
}

export async function updateProfile(
    projectId: string,
    profileId: string,
    updates: {
        name?: string;
        context?: string;
        mockTools?: boolean;
        mockPrompt?: string;
    }
): Promise<void> {
    await projectAuthCheck(projectId);

    const updateData: any = {
        ...updates,
        lastUpdatedAt: new Date().toISOString(),
    };

    await testProfilesCollection.updateOne(
        {
            _id: new ObjectId(profileId),
            projectId,
        },
        {
            $set: updateData,
        }
    );
}

export async function listRuns(
    projectId: string,
    page: number = 1,
    pageSize: number = 10
): Promise<{
    runs: WithStringId<z.infer<typeof TestRun>>[];
    total: number;
}> {
    await projectAuthCheck(projectId);
    const skip = (page - 1) * pageSize;
    const total = await testRunsCollection.countDocuments({ projectId });
    
    const runs = await testRunsCollection
        .find({ projectId })
        .sort({ startedAt: -1 }) // Sort by most recent first
        .skip(skip)
        .limit(pageSize)
        .toArray();

    return {
        runs: runs.map(run => ({
            ...run,
            _id: run._id.toString(),
        })),
        total,
    };
}

export async function getRun(projectId: string, runId: string): Promise<WithStringId<z.infer<typeof TestRun>> | null> {
    await projectAuthCheck(projectId);
    
    const run = await testRunsCollection.findOne({
        _id: new ObjectId(runId),
        projectId,
    });
    if (!run) {
        return null;
    }
    const { _id, ...rest } = run;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function deleteRun(projectId: string, runId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await testRunsCollection.deleteOne({
        _id: new ObjectId(runId),
        projectId,
    });
}

export async function createRun(
    projectId: string,
    data: {
        simulationIds: string[];
        workflowId: string;
    }
): Promise<WithStringId<z.infer<typeof TestRun>>> {
    await projectAuthCheck(projectId);

    // Increment the testRunCounter and get the new value
    const result = await projectsCollection.findOneAndUpdate(
        { _id: projectId },
        { $inc: { testRunCounter: 1 } },
        { returnDocument: 'after' }
    );

    if (!result) {
        throw new Error("Project not found");
    }

    const runNumber = result.testRunCounter || 1;

    const doc = {
        ...data,
        projectId,
        name: `Run #${runNumber}`,
        status: 'pending' as const,
        startedAt: new Date().toISOString(),
        aggregateResults: {
            total: 0,
            passCount: 0,
            failCount: 0,
        },
    };
    const insertResult = await testRunsCollection.insertOne(doc);
    return {
        ...doc,
        _id: insertResult.insertedId.toString(),
    };
}

export async function updateRun(
    projectId: string,
    runId: string,
    updates: {
        status?: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'error';
        completedAt?: string;
        aggregateResults?: {
            total: number;
            passCount: number;
            failCount: number;
        };
    }
): Promise<void> {
    await projectAuthCheck(projectId);

    const updateData: any = {
        ...updates,
    };

    await testRunsCollection.updateOne(
        {
            _id: new ObjectId(runId),
            projectId,
        },
        {
            $set: updateData,
        }
    );
}

export async function cancelRun(projectId: string, runId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await testRunsCollection.updateOne(
        { _id: new ObjectId(runId), projectId },
        { $set: { status: 'cancelled' } }
    );
}

export async function listResults(
    projectId: string,
    runId: string,
    page: number = 1,
    pageSize: number = 10
): Promise<{
    results: WithStringId<z.infer<typeof TestResult>>[];
    total: number;
}> {
    await projectAuthCheck(projectId);
    const skip = (page - 1) * pageSize;
    const total = await testResultsCollection.countDocuments({ projectId, runId });
    
    const results = await testResultsCollection
        .find({ projectId, runId })
        .skip(skip)
        .limit(pageSize)
        .toArray();

    return {
        results: results.map(result => ({
            ...result,
            _id: result._id.toString(),
        })),
        total,
    };
}

export async function getResult(projectId: string, resultId: string): Promise<WithStringId<z.infer<typeof TestResult>> | null> {
    await projectAuthCheck(projectId);
    
    const result = await testResultsCollection.findOne({
        _id: new ObjectId(resultId),
        projectId,
    });
    if (!result) {
        return null;
    }
    const { _id, ...rest } = result;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function deleteResult(projectId: string, resultId: string): Promise<void> {
    await projectAuthCheck(projectId);

    await testResultsCollection.deleteOne({
        _id: new ObjectId(resultId),
        projectId,
    });
}

export async function createResult(
    projectId: string,
    data: {
        runId: string;
        simulationId: string;
        result: 'pass' | 'fail';
        details: string;
        transcript: string;
    }
): Promise<WithStringId<z.infer<typeof TestResult>>> {
    await projectAuthCheck(projectId);

    const doc = {
        ...data,
        projectId,
    };
    const result = await testResultsCollection.insertOne(doc);
    return {
        ...doc,
        _id: result.insertedId.toString(),
    };
}

export async function updateResult(
    projectId: string,
    resultId: string,
    updates: {
        result?: 'pass' | 'fail';
        details?: string;
    }
): Promise<void> {
    await projectAuthCheck(projectId);

    await testResultsCollection.updateOne(
        {
            _id: new ObjectId(resultId),
            projectId,
        },
        {
            $set: updates,
        }
    );
}

export async function getSimulationResult(
    projectId: string,
    runId: string,
    simulationId: string
): Promise<WithStringId<z.infer<typeof TestResult>> | null> {
    await projectAuthCheck(projectId);
    
    const result = await testResultsCollection.findOne({
        projectId,
        runId,
        simulationId
    });

    if (!result) {
        return null;
    }

    const { _id, ...rest } = result;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function listRunSimulations(
    projectId: string,
    simulationIds: string[]
): Promise<WithStringId<z.infer<typeof TestSimulation>>[]> {
    await projectAuthCheck(projectId);
    
    const simulations = await testSimulationsCollection
        .find({ 
            _id: { $in: simulationIds.map(id => new ObjectId(id)) },
            projectId 
        })
        .toArray();

    // Fetch associated scenario and profile names
    const enrichedSimulations = await Promise.all(simulations.map(async (simulation) => {
        const scenario = simulation.scenarioId ? await testScenariosCollection.findOne({ _id: new ObjectId(simulation.scenarioId) }) : null;
        const profile = simulation.profileId ? await testProfilesCollection.findOne({ _id: new ObjectId(simulation.profileId) }) : null;
        return {
            ...simulation,
            _id: simulation._id.toString(),
            scenarioName: scenario?.name || 'Unknown',
            profileName: profile?.name || 'None',
        };
    }));

    return enrichedSimulations;
}
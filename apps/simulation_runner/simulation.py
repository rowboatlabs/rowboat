import asyncio
import logging
from typing import List
import json
import os
from openai import OpenAI

from scenario_types import TestSimulation, TestResult, AggregateResults, TestScenario

from db import write_test_result, get_scenario_by_id
from rowboat import Client, StatefulChat

openai_client = OpenAI()
MODEL_NAME = "gpt-4o"
ROWBOAT_API_HOST = os.environ.get("ROWBOAT_API_HOST", "http://127.0.0.1:3000").strip()

async def simulate_simulation(
    scenario: TestScenario,
    profile_id: str,
    pass_criteria: str,
    rowboat_client: Client,
    workflow_id: str,
    max_iterations: int = 5
) -> tuple[str, str, str]:
    """
    Runs a mock simulation for a given TestSimulation asynchronously.
    After simulating several turns of conversation, it evaluates the conversation.
    Returns a tuple of (evaluation_result, details, transcript_str).
    """

    loop = asyncio.get_running_loop()
    pass_criteria = pass_criteria

    # Todo: add profile_id
    support_chat = StatefulChat(
        rowboat_client,
        workflow_id=workflow_id,
        test_profile_id=profile_id
    )

    messages = [
        {
            "role": "system",
            "content": (
                f"You are role playing a customer talking to a chatbot (the user is role playing the chatbot). Have the following chat with the chatbot. Scenario:\n{scenario.description}. You are provided no other information. If the chatbot asks you for information that is not in context, go ahead and provide one unless stated otherwise in the scenario. Directly have the chat with the chatbot. Start now with your first message."
            )
        }
    ]

    # -------------------------
    # (1) MAIN SIMULATION LOOP
    # -------------------------
    for _ in range(max_iterations):
        openai_input = messages

        # Run OpenAI API call in a separate thread (non-blocking)
        simulated_user_response = await loop.run_in_executor(
            None,  # default ThreadPool
            lambda: openai_client.chat.completions.create(
                model=MODEL_NAME,
                messages=openai_input,
                temperature=0.0,
            )
        )

        simulated_content = simulated_user_response.choices[0].message.content.strip()
        messages.append({"role": "assistant", "content": simulated_content})
        # Run Rowboat chat in a thread if it's synchronous
        rowboat_response = await loop.run_in_executor(
            None,
            lambda: support_chat.run(simulated_content)
        )

        messages.append({"role": "user", "content": rowboat_response})

    # -------------------------
    # (2) EVALUATION STEP
    # -------------------------
    # swap the roles of the assistant and the user
    transcript_str = ""
    for m in messages:
        if m.get("role") == "assistant":
            m["role"] = "user"
        elif m.get("role") == "user":
            m["role"] = "assistant"
        role = m.get("role", "unknown")
        content = m.get("content", "")
        transcript_str += f"{role.upper()}: {content}\n"

    # Store the transcript as a JSON string
    transcript = json.dumps(messages)

    # We use passCriteria as the evaluation "criteria."
    evaluation_prompt = [
        {
            "role": "system",
            "content": (
                f"You are a neutral evaluator. Evaluate based on these criteria:\n"
                f"{pass_criteria}\n\n"
                "Return ONLY a JSON object in this format:\n"
                '{"verdict": "pass", "details": <reason>} or '
                '{"verdict": "fail", "details": <reason>}.'
            )
        },
        {
            "role": "user",
            "content": (
                f"Here is the conversation transcript:\n\n{transcript_str}\n\n"
                "Did the support bot answer correctly or not? "
                "Return only 'pass' or 'fail' for verdict, and a brief explanation for details."
            )
        }
    ]

    # Run evaluation in a separate thread
    eval_response = await loop.run_in_executor(
        None,
        lambda: openai_client.chat.completions.create(
            model=MODEL_NAME,
            messages=evaluation_prompt,
            temperature=0.0,
            response_format={"type": "json_object"}
        )
    )

    if not eval_response.choices:
        raise Exception("No evaluation response received from model")

    response_json_str = eval_response.choices[0].message.content
    # Attempt to parse the JSON
    response_json = json.loads(response_json_str)
    evaluation_result = response_json.get("verdict")
    details = response_json.get("details")

    if evaluation_result is None:
        raise Exception("No 'verdict' field found in evaluation response")

    return (evaluation_result, details, transcript)

async def simulate_simulations(
    simulations: List[TestSimulation],
    run_id: str,
    workflow_id: str,
    api_key: str,
    max_iterations: int = 5
) -> AggregateResults:
    """
    Simulates a list of TestSimulations asynchronously and aggregates the results.
    """
    if not simulations:
        # Return an empty result if there's nothing to simulate
        return AggregateResults(total=0, pass_=0, fail=0)

    project_id = simulations[0].projectId

    client = Client(
        host=ROWBOAT_API_HOST,
        project_id=project_id,
        api_key=api_key
    )

    # Store results here
    results: List[TestResult] = []

    for simulation in simulations:
        verdict, details, transcript = await simulate_simulation(
            scenario=get_scenario_by_id(simulation.scenarioId),
            profile_id=simulation.profileId,
            pass_criteria=simulation.passCriteria,
            rowboat_client=client,
            workflow_id=workflow_id,
            max_iterations=max_iterations
        )

        # Create a new TestResult
        test_result = TestResult(
            projectId=project_id,
            runId=run_id,
            simulationId=simulation.id,
            result=verdict,
            details=details,
            transcript=transcript
        )
        results.append(test_result)

        # Persist the test result
        write_test_result(test_result)

    # Aggregate pass/fail
    total_count = len(results)
    pass_count = sum(1 for r in results if r.result == "pass")
    fail_count = sum(1 for r in results if r.result == "fail")

    return AggregateResults(
        total=total_count,
        passCount=pass_count,
        failCount=fail_count
    )

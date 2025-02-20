from rowboat import Client, StatefulChat
from typing import List
import json
import os
import asyncio
from openai import OpenAI
from scenario_types import Scenario, SimulationResult, SimulationAggregateResult
from db import write_simulation_result

openai_client = OpenAI()
MODEL_NAME = "gpt-4o"
ROWBOAT_API_HOST = os.environ.get("ROWBOAT_API_HOST", "http://127.0.0.1:3000").strip()

async def simulate_scenario(scenario: Scenario, rowboat_client: Client, workflow_id: str, max_iterations: int = 5) -> tuple[str, str, str]:
    """
    Runs a mock simulation for a given scenario asynchronously.
    After simulating several turns of conversation, it evaluates the conversation.
    Returns a tuple of (evaluation_result, details, transcript_str).
    """
    loop = asyncio.get_running_loop()

    support_chat = StatefulChat(
        rowboat_client,
        system_prompt=f"{f'Context: {scenario.context}' if scenario.context else ''}",
        workflow_id=workflow_id
    )

    messages = [
        {
            "role": "system",
            "content": f"Simulate the user based on the scenario: \n {scenario.description}"
        }
    ]

    # -------------------------
    # 1) MAIN SIMULATION LOOP
    # -------------------------
    for i in range(max_iterations):
        openai_input = messages

        # Run OpenAI API call in a separate thread
        simulated_user_response = await loop.run_in_executor(
            None,  # Use default thread pool
            lambda: openai_client.chat.completions.create(
                model=MODEL_NAME,
                messages=openai_input,
                temperature=0.0,
            )
        )

        simulated_content = simulated_user_response.choices[0].message.content

        # Run support_chat.run in a thread if it's synchronous
        rowboat_response = await loop.run_in_executor(
            None,
            lambda: support_chat.run(simulated_content)
        )

        messages.append({"role": "assistant", "content": rowboat_response})

    # -------------------------
    # 2) EVALUATION STEP
    # -------------------------
    transcript_str = ""
    for m in messages:
        role = m.get("role", "unknown")
        content = m.get("content", "")
        transcript_str += f"{role.upper()}: {content}\n"

    evaluation_prompt = [
        {
            "role": "system",
            "content": (
                f"You are a neutral evaluator. Evaluate based on these criteria:\n{scenario.criteria}\n\nReturn ONLY a JSON object with format: "
                '{"verdict": "pass", "details": <the reason for pass in 2 sentences>} if the support bot answered correctly, or {"verdict": "fail", "details": <the reason for fail in 2 sentences>} if not.'
            )
        },
        {
            "role": "user",
            "content": (
                f"Here is the conversation transcript:\n\n{transcript_str}\n\n"
                "Did the support bot answer correctly or not? Return only 'pass' or 'fail' for verdict, and a brief 2 sentence explanation for details."
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
    else:
        response_json = json.loads(eval_response.choices[0].message.content)
        evaluation_result = response_json.get("verdict")
        details = response_json.get("details")
        if evaluation_result is None:
            raise Exception("No verdict field found in evaluation response")

    return (evaluation_result, details, transcript_str)

async def simulate_scenarios(scenarios: List[Scenario], runId: str, workflow_id: str, api_key: str, max_iterations: int = 5):
    """
    Simulates a list of scenarios asynchronously and aggregates the results.
    """
    project_id = scenarios[0].projectId
    client = Client(
        host=ROWBOAT_API_HOST,
        project_id=project_id,
        api_key=api_key
    )
    results = []

    for scenario in scenarios:
        # Await the asynchronous simulate_scenario
        result, details, transcript = await simulate_scenario(scenario, client, workflow_id, max_iterations)

        simulation_result = SimulationResult(
            projectId=project_id,
            runId=runId,
            scenarioId=scenario.id,
            result=result,
            details=details,
            transcript=transcript
        )
        results.append(simulation_result)
        write_simulation_result(simulation_result)

    aggregate_result = SimulationAggregateResult(**{
        "total": len(scenarios),
        "pass": sum(1 for result in results if result.result == "pass"),
        "fail": sum(1 for result in results if result.result == "fail")
    })
    return aggregate_result
# Guardrails
from src.utils.common import generate_llm_output
import os
import copy

from .execute_turn import Agent, Response, create_response

from src.utils.common import common_logger, generate_openai_output, update_tokens_used
logger = common_logger

def classify_hallucination(context: str, assistant_response: str, chat_history: list, model: str) -> str:
    """
    Checks if an assistant's response contains hallucinations by comparing against provided context.

    Args:
        context (str): The context/knowledge base to check the response against
        assistant_response (str): The response from the assistant to validate
        chat_history (list): List of previous chat messages for context

    Returns:
        str: Verdict indicating level of hallucination:
            'yes-absolute' - completely supported by context
            'yes-common-sensical' - supported with common sense interpretation
            'no-absolute' - not supported by context
            'no-subtle' - not supported but difference is subtle
    """
    chat_history_str = "\n".join([f"{message['role']}: {message['content']}" for message in chat_history])

    prompt = f"""
    You are a guardrail agent. Your job is to check if the response is hallucinating.

    ------------------------------------------------------------------------
    Here is the context:
    {context}

    ------------------------------------------------------------------------
    Here is the chat history message:
    {chat_history_str}

    ------------------------------------------------------------------------
    Here is the response:
    {assistant_response}

    ------------------------------------------------------------------------
    As a hallucination guardrail, your job is to go through each line of the response and check if it is completely supported by the context. Even if a single line is not supported, the response is no.

    Output a single verdict for the entire response. don't provide any reasoning. The output classes are

    yes-absolute:  completely supported by the context
    yes-common-sensical: but with some common sense interpretation
    no-absolute:  not supported by the context
    no-subtle:  not supported by the context but the difference is subtle

    Output of of the classes:
    verdict : yes-absolute/yes-common-sensical/no-absolute/no-subtle

    Example 1: The response is completely supported by the context.
    User Input:
    Context: "Our airline provides complimentary meals and beverages on all international flights. Passengers are allowed one carry-on bag and one personal item."
    Chat History:
    User: "Do international flights with your airline offer free meals?"
    Response: "Yes, all international flights with our airline offer free meals and beverages."
    Output:    verdict: yes-absolute

    Example 2: The response is generally true and could be deduced with common sense interpretation, though not explicitly stated in the context.
    User Input:
    Context: "Flights may experience delays due to weather conditions. In such cases, the airline staff will provide updates at the airport."
    Chat History:
    User: "Will there be announcements if my flight is delayed?"
    Response: "Yes, if your flight is delayed, there will be announcements at the airport."
    Output:    verdict: yes-common-sensical

    Example 3: The response is not supported by the context and contains glaring inaccuracies.
    User Input:
    Context: "You can cancel your ticket online up to 24 hours before the flight's departure time and receive a full refund."
    Chat History:
    User: "Can I get a refund if I cancel 12 hours before the flight?"
    Response: "Yes, you can get a refund if you cancel 12 hours before the flight."
    Output:    verdict: no-absolute

    Example 4: The response is not supported by the context but the difference is subtle.
    User Input:
    Context: "Our frequent flyer program offers discounts on checked bags for members who have achieved Gold status."
    Chat History:
    User: "As a member, do I get discounts on checked bags?"
    Response: "Yes, members of our frequent flyer program get discounts on checked bags."
    Output:    verdict: no-subtle
    """
    messages = [
        {
            "role": "system",
            "content": prompt,
        },
    ]
    response = generate_llm_output(messages, model)
    return response

def post_process_response(messages: list, post_processing_agent_name: str, post_process_instructions: str, style_prompt: str = None, context: str = None, model: str = "gpt-4o", tokens_used: dict = {}, last_agent: Agent = None) -> dict:
    agent_instructions = last_agent.instructions
    agent_history = last_agent.history
    # agent_instructions = ''
    # agent_history = []

    pending_msg = copy.deepcopy(messages[-1])
    logger.debug(f"Pending message keys: {pending_msg.keys()}")

    skip = False

    if pending_msg.get("tool_calls"):
        logger.info("Last message is a tool call, skipping post processing and setting last message to external")
        skip = True

    elif not pending_msg['response_type'] == "internal":
        logger.info("Last message is not internal, skipping post processing and setting last message to external")
        skip = True

    elif not pending_msg['content']:
        logger.info("Last message has no content, skipping post processing and setting last message to external")
        skip = True

    elif not post_process_instructions:
        logger.info("No post process instructions, skipping post processing and setting last message to external")
        skip = True

    if skip:
        pending_msg['response_type'] = "external"
        response = Response(
            messages=[],
            tokens_used=tokens_used,
            agent=last_agent,
            error_msg=''
        )
        return response

    agent_history_str = f"\n{'*'*100}\n".join([f"Role: {message['role']} | Content: {message.get('content', 'None')} | Tool Calls: {message.get('tool_calls', 'None')}" for message in agent_history[:-1]])
    logger.debug(f"Agent history: {agent_history_str}")

    prompt = f"""
        # ROLE

        You are a post processing agent responsible for rewriting a response generated by an agent, according to instructions provided below. Ensure that the response you produce adheres to the instructions provided to you (if any).
        ------------------------------------------------------------------------

        # ADDITIONAL INSTRUCTIONS

        Here are additional instructions that the admin might have configured for you:
        {post_process_instructions}

        ------------------------------------------------------------------------

        # CHAT HISTORY

        Here is the chat history:
        {agent_history_str}
    """
    if context:
        context_prompt = f"""
        ------------------------------------------------------------------------
        # CONTEXT

        Here is the context:
        {context}
        """
        prompt += context_prompt

    if style_prompt:
        style_prompt = f"""
        ------------------------------------------------------------------------
        # STYLE PROMPT

        Here is the style prompt:
        {style_prompt}
        """
        prompt += style_prompt

    agent_response_and_instructions = f"""

    ------------------------------------------------------------------------
    # AGENT INSTRUCTIONS

    Here are the instructions to the agent generating the response:
    {agent_instructions}

    ------------------------------------------------------------------------
    # AGENT RESPONSE

    Here is the response that the agent has generated:
    {pending_msg['content']}

    """
    prompt += agent_response_and_instructions

    logger.debug(f"Sanitizing response for style. Original response: {pending_msg['content']}")
    completion = generate_openai_output(
        messages=[
            {"role": "system", "content": prompt}
        ],
        model = model,
        return_completion=True
    )
    content = completion.choices[0].message.content
    if content:
        content = content.strip().lstrip().rstrip()
        tokens_used = update_tokens_used(provider="openai", model=model, tokens_used=tokens_used, completion=completion)
        logger.debug(f"Response after style check: {content}, tokens used: {tokens_used}")

    pending_msg['content'] = content if content else pending_msg['content']
    pending_msg['response_type'] = "external"
    pending_msg['sender'] = pending_msg['sender'] + f' >> {post_processing_agent_name}'

    response = Response(
        messages=[pending_msg],
        tokens_used=tokens_used,
        agent=last_agent,
        error_msg=''
    )

    return response

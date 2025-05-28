![ui](/assets/banner.png)

<h2 align="center">Let AI build multi-agent workflows for you in minutes</h2>
<h5 align="center">

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs%2Frowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

[Quickstart](#quick-start) | [Docs](https://docs.rowboatlabs.com/) | [Discord](https://discord.gg/rxB8pzHxaS) | [Website](https://www.rowboatlabs.com/) | [Youtube](https://www.youtube.com/@RowBoatLabs) 

</h5>

- ✨ **Start from an idea -> copilot builds your multi-agent workflows**
   - E.g. "Build me an assistant for a food delivery company to handle delivery status and missing items. Include the necessary tools."
- 🌐 **Connect MCP servers**
   - Add the MCP servers in settings -> import the tools into Rowboat.     
- 📞 **Integrate into your app using the HTTP API or Python SDK**
   - Grab the project ID and generated API key from settings and use the API.

Powered by OpenAI's Agents SDK, Rowboat is the fastest way to build multi-agents!

## Quick start
1. Set your OpenAI key
      ```bash
   export OPENAI_API_KEY=your-openai-api-key
   ```
      
2. Clone the repository and start Rowboat
   ```bash
   git clone git@github.com:rowboatlabs/rowboat.git
   cd rowboat
   ./start.sh
   ```

3. Access the app at [http://localhost:3000](http://localhost:3000).

Note: We have added native RAG support including file-uploads and URL scraping. See the [RAG](https://docs.rowboatlabs.com/using_rag) section of our docs for this.

Note: See the [Using custom LLM providers](https://docs.rowboatlabs.com/setup/#using-custom-llm-providers) section of our docs for using custom providers like OpenRouter and LiteLLM.

## Demo

#### Create a multi-agent assistant with MCP tools by chatting with Rowboat
[![Screenshot 2025-04-23 at 00 25 31](https://github.com/user-attachments/assets/c8a41622-8e0e-459f-becb-767503489866)](https://youtu.be/YRTCw9UHRbU)

## Integrate with Rowboat agents

There are 2 ways to integrate with the agents you create in Rowboat

1. HTTP API
   - You can use the API directly at [http://localhost:3000/api/v1/](http://localhost:3000/api/v1/)
   - See [API Docs](https://docs.rowboatlabs.com/using_the_api/) for details
   ```bash
   curl --location 'http://localhost:3000/api/v1/<PROJECT_ID>/chat' \
   --header 'Content-Type: application/json' \
   --header 'Authorization: Bearer <API_KEY>' \
   --data '{
       "messages": [
           {
               "role": "user",
               "content": "tell me the weather in london in metric units"
           }
       ],
       "state": null
   }'
   ```
   

2. Python SDK
   You can use the included Python SDK to interact with the Agents
   ```
   pip install rowboat
   ```

   See [SDK Docs](https://docs.rowboatlabs.com/using_the_sdk/) for details. Here is a quick example:
   ```python
   from rowboat import Client, StatefulChat
   from rowboat.schema import UserMessage, SystemMessage

   # Initialize the client
   client = Client(
       host="http://localhost:3000",
       project_id="<PROJECT_ID>",
       api_key="<API_KEY>"
   )

   # Create a stateful chat session (recommended)
   chat = StatefulChat(client)
   response = chat.run("What's the weather in London?")
   print(response)

   # Or use the low-level client API
   messages = [
       SystemMessage(role='system', content="You are a helpful assistant"),
       UserMessage(role='user', content="Hello, how are you?")
   ]
   
   # Get response
   response = client.chat(messages=messages)
   print(response.messages[-1].content)
   ```


Refer to [Docs](https://docs.rowboatlabs.com/) to learn how to start building agents with Rowboat.

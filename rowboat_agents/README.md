# 🤖 Agents

## 📝 Overview  
- RowBoat Agents is a multi-agent framework that powers conversations using agentic workflows.  
- Built on top of [OpenAI Swarm](https://github.com/openai/swarm) with custom enhancements and improvements. Check the [NOTICE](https://github.com/rowboatlabs/rowboat/blob/main/apps/agents/NOTICE.md) for attribution and licensing details (MIT license).  

---

## 🕸️ Graph-based Framework  
- Multi-agent systems are represented as graphs, where each agent is a node in the graph.  
- RowBoat Agents accepts Directed Acyclic Graph (DAG) workflows, which define agents, tools, and their connections.
- Configure workflows using the RowBoat Studio (UI) with the help of an AI copilot. Setup instructions can be found in the [main README](https://github.com/rowboatlabs/rowboat).  
- The framework is stateless, meaning that it requires the upstream service to pass in the current `state` and `messages` in every turn.
- At each conversation turn:  
  - The agents are initialized using the current `state`.
  - The graph is traversed based on `messages`, `state`, and `workflow`
  - Response `messages` and a new `state` are generated.  
  - If `messages` contain tool calls, the upstream service must invoke the necessary tools and send the tool results back to continue the interaction.

---

## 🗂️ Key Request and Response Fields

### 📤 Request  
- `messages`: List of user messages  
- `state`: Active agent state and histories  
- `workflow`: Graph of agents, tools, and connections  

**Example JSON**: `tests/sample_requests/default_example.json`  

---

### 📥 Response  
- `messages`: List of response messages (may contain tool calls)  
- `state`: Updated state to pass in the next request (since the framework is stateless)  

**Example JSON**: `tests/sample_responses/default_example.json`  

---

## 🛠️ Using the Framework

Ensure you are in this directory (`cd apps/agents` from the root directory of this repo) before running any of the below commands.

### ⚙️ Set Up Conda Environment  
- `conda create -n myenv python=3.12`  
- `conda activate myenv`  
- Note: Python >= 3.10 required  

---

### 📦 Install Dependencies

#### If using poetry
- `pip install poetry`
- `poetry install`

#### If using pip
`pip install -r requirements.txt`

### 🔑 Set up .env file
Copy `.env.example` to `.env` and add your API keys

### 🧪 Run interactive test
`python -m tests.interactive --config default_config.json --sample_request default_example.json --load_messages`
- `--config`: Config json filename, under `configs` folder
- `--sample_request`: Path to the sample request file, under `tests/sample_requests` folder
- `--load_messages`: If set, it will additionally load the initial set of messages from the sample request file. Else, user input will be required starting from the first message.

### 🌐 Set up server

- First, add this directory to your PYTHONPATH, using: `export PYTHONPATH=$PYTHONPATH:$(pwd)`
- For local testing: `flask --app src.app.main run --port=4040`
- To set up the server on a remote machine: `gunicorn -b 0.0.0.0:4040 src.app.main:app`

### 🖥️ Run test client
`python -m tests.app_client --sample_request default_example.json --api_key test`
- `--sample_request`: Path to the sample request file, under `tests/sample_requests` folder
- `--api_key`: API key to use for authentication. This is the same key as the one in the `.env` file.

## 📖 More details

### 🔍 Specifics
- **Format**: Uses OpenAI's messages format when passing messages. 
- **LLMs**: Currently, only OpenAI LLMs (e.g. gpt-4o, gpt-4o-mini) are supported. Easy to expand to other LLMs like Claude, Gemini or self-hosted models.
- **Responses**: Here are some examples of responses that the framework can return:
  - A list of one user-facing message
  - A list of one or more tool calls
  - A list of one user-facing message and one or more tool calls
- ⚠️ **Errors**: Errors are thrown as a tool call `raise_error` with the error message as the argument. Real-time error handling will be managed by the upstream service. 

### 🗂️ Important directories and files
- `src/`: Contains all source code for the agents app
  - `src/app/`: Contains Flask app which exposes the framework as a service
  - `src/graph/`: Contains logic to run every turn of the conversation
    - `src/graph/core.py`: Core graph implementation which parses the workflow config, creates agents from it and runs the turn of conversation (through the `run_turn` function)
  - `src/swarm/`: RowBoat's custom implementation of OpenAI Swarm, which is used by `src/graph/core.py`
- `tests/`: Contains sample requests, an interactive client and a test client which mocks an upstream service
- `configs/`: Contains graph configurations (changed infrequently)
- `tests/sample_requests/`: Contains sample request files for the agents app

### 🔄 High-level flow
- `app/main.py` receives the request JSON from an upstream service, parses it and sends it to `src/graph/core.py`
- `src/graph/core.py` creates the agent graph object from scratch and uses `src/swarm/core.py` to run the turn
- `src/swarm/core.py` runs the turn by performing actual LLM calls and internal tool invocations to transitiion between agents
- `src/graph/core.py` returns the response messages and the new state to `app/main.py`, which relays it back to the upstream service
- The upstream services appends any new user messages to the history of messages and sends the messages back along with the new state to `app/main.py` as part of the next request. The process repeats until the upstream service completes its conversation with the user.

### 🚫 Limitations
- Does not support streaming currently.
- Cannot respond with multiple user-facing messages in the same turn.

# RowBoat Labs  
🌐 Visit [RowBoat Labs](https://www.rowboatlabs.com) to learn more!  
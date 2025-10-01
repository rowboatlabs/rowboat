![ui](/assets/banner.png)

<h2 align="center">AI that builds and manages your agent swarms</h2>
<h5 align="center">

<p align="center" style="display: flex; justify-content: center; gap: 20px; align-items: center;">
  <a href="https://trendshift.io/repositories/13609" target="blank">
    <img src="https://trendshift.io/api/badge/repositories/13609" alt="rowboatlabs%2Frowboat | Trendshift" width="250" height="55"/>
  </a>
</p>

<p align="center">
  <a href="https://docs.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Docs" src="https://img.shields.io/badge/Docs-8b5cf6?labelColor=8b5cf6&logo=readthedocs&logoColor=white">
  </a>
  <a href="https://discord.gg/rxB8pzHxaS" target="_blank" rel="noopener">
    <img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white&labelColor=5865F2">
  </a>
  <a href="https://www.rowboatlabs.com/" target="_blank" rel="noopener">
    <img alt="Website" src="https://img.shields.io/badge/Website-10b981?labelColor=10b981&logo=window&logoColor=white">
  </a>
  <a href="https://www.youtube.com/@RowBoatLabs" target="_blank" rel="noopener">
    <img alt="YouTube" src="https://img.shields.io/badge/YouTube-FF0000?labelColor=FF0000&logo=youtube&logoColor=white">
  </a>
  <a href="https://www.linkedin.com/company/rowboat-labs" target="_blank" rel="noopener">
    <img alt="LinkedIn" src="https://custom-icon-badges.demolab.com/badge/LinkedIn-0A66C2?logo=linkedin-white&logoColor=fff">
  </a>
  <a href="https://x.com/intent/user?screen_name=rowboatlabshq" target="_blank" rel="noopener">
    <img alt="Twitter" src="https://img.shields.io/twitter/follow/rowboatlabshq?style=social">
  </a>
  <a href="https://www.ycombinator.com" target="_blank" rel="noopener">
    <img alt="Y Combinator" src="https://img.shields.io/badge/Y%20Combinator-S24-orange">
  </a>
</p>


</h5>
<p align="center">
⚡ Build agent swarms instantly with natural language | 🔌 Connect tools with one-click integrations | 📂 Power with knowledge by adding documents for RAG | 🔄 Automate workflows by setting up triggers and actions | 🚀 Deploy anywhere via API or SDK<br><br>
☁️ Prefer a hosted version? Use our <b><a href="https://rowboatlabs.com">cloud</a></b> to starting building agents right away!
</p>


## Quick start
1. Set your OpenAI key
   ```bash
   export OPENAI_API_KEY=your-openai-api-key  
   ```
      
2. Clone the repository and start Rowboat (requires Docker)
   ```bash
   git clone git@github.com:rowboatlabs/rowboat.git
   cd rowboat
   ./start.sh
   ```

3. Access the app at [http://localhost:3000](http://localhost:3000).

To add tools, RAG, more LLMs, and  triggers checkout the [Advanced](#advanced) section below.

## Demos
#### Meeting-prep assistant
Chat with the copilot to build a meeting-prep workflow, then add a calendar invite as a trigger. Watch the full demo [here](https://youtu.be/KZTP4xZM2DY).
[![meeting-prep](https://github.com/user-attachments/assets/27755ef5-6549-476f-b9c0-50bef8770384)](https://youtu.be/KZTP4xZM2DY)

#### Customer support assistant
Chat with the copilot to build a customer support assistant, then connect your MCP server, and data for RAG. Watch the full demo [here](https://youtu.be/Xfo-OfgOl8w).
[![output](https://github.com/user-attachments/assets/97485fd7-64c3-4d60-a627-f756a89dee64)](https://youtu.be/Xfo-OfgOl8w)

#### Personal assistant
Chat with the copilot to build a personal assistant. Watch the full demo [here](https://youtu.be/6r7P4Vlcn2g).
[![personal-assistant](https://github.com/user-attachments/assets/0f1c0ffd-23ba-4b49-8bfb-ec7a846f1332)](https://youtu.be/6r7P4Vlcn2g)

## Advanced
1. Native RAG Support: Enable file uploads and URL scraping with Rowboat's built-in RAG capabilities – see [RAG Guide](https://docs.rowboatlabs.com/docs/using-rowboat/rag).

2. Custom LLM Providers: Use any LLM provider, including aggregators like OpenRouter and LiteLLM - see [Using more LLM providers](https://docs.rowboatlabs.com/docs/using-rowboat/customise/custom-llms).

3. Tools & Triggers: Add tools and event triggers (e.g., Gmail, Slack) for automation – see [Tools](https://docs.rowboatlabs.com/docs/using-rowboat/tools) & [Triggers](https://docs.rowboatlabs.com/docs/using-rowboat/triggers).

4. API & SDK: Integrate Rowboat agents directly into your app – see [API](https://docs.rowboatlabs.com/docs/api-sdk/using_the_api) & [SDK](https://docs.rowboatlabs.com/docs/api-sdk/using_the_sdk) docs.

##

Refer to [Docs](https://docs.rowboatlabs.com/) to learn how to start building agents with Rowboat.

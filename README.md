![ui](/assets/banner.png)

<h2 align="center">Let AI build multi-agent workflows for you in minutes</h2>
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
⚡ Build AI agents instantly with natural language. | 🔌 Connect tools with one-click integrations. | 📂 Power with knowledge by adding documents for RAG. | 🔄 Automate workflows by setting up triggers and actions. | 🚀 Deploy anywhere via API or SDK.<br><br>
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
#### Create a meeting-prep assistant by chatting with the copilot.
[![meeting-prep](https://github.com/user-attachments/assets/27755ef5-6549-476f-b9c0-50bef8770384)](https://youtu.be/KZTP4xZM2DY)

The full demo is available [here](https://youtu.be/KZTP4xZM2DY)

## Advanced
1. To enable native RAG support including file-uploads and URL scraping, see [RAG](https://docs.rowboatlabs.com/using_rag)

2. You can use any LLM provider including aggregators like OpenRouter and LiteLLM - see [Using custom LLM providers](https://docs.rowboatlabs.com/setup/#using-custom-llm-providers)

3. To enable external event triggers, see [Triggers](https://docs.rowboatlabs.com/using_triggers)

4. To integrate Rowboat agents into you app see our [API & SDK](https://docs.rowboatlabs.com/api_sdk)

##

Refer to [Docs](https://docs.rowboatlabs.com/) to learn how to start building agents with Rowboat.

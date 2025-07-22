#!/usr/bin/env python3
"""
Script to dump all Composio toolkits and tools into a markdown file.
This generates comprehensive documentation for LLM context.
"""

import subprocess
import sys
import json
from typing import Dict, List, Any

def install_composio():
    """Install Composio if not already installed."""
    try:
        import composio
        print("Composio already installed")
    except ImportError:
        print("Installing Composio...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "composio-core", "--break-system-packages"])
        print("Composio installed successfully")

def get_all_toolkits_and_tools():
    """Fetch all available toolkits and their tools."""
    try:
        from composio import Composio
        from composio.tools import ComposioToolSet
        
        client = Composio()
        toolset = ComposioToolSet()
        
        # Get all available apps/toolkits
        apps = client.apps.get()
        
        toolkits_data = {}
        
        # Get ALL apps - no limits
        print(f"Found {len(apps)} total toolkits to process...")
        
        processed_count = 0
        total_tools_count = 0
        
        for app in apps:
            processed_count += 1
            app_name = app.key
            print(f"Processing toolkit {processed_count}/{len(apps)}: {app_name}")
            
            # Get app details
            app_details = {
                'name': app.name,
                'key': app.key,
                'description': getattr(app, 'description', 'No description available'),
                'logo': getattr(app, 'logo', ''),
                'categories': getattr(app, 'categories', []),
                'tools': []
            }
            
            try:
                # Get ALL actions/tools for this app - no limits
                actions = client.actions.get(apps=[app_name])
                print(f"  Found {len(actions)} tools for {app_name}")
                total_tools_count += len(actions)
                
                for action in actions:
                    tool_info = {
                        'name': action.name,
                        'display_name': getattr(action, 'display_name', action.name),
                        'description': getattr(action, 'description', 'No description available'),
                        'parameters': getattr(action, 'parameters', {}),
                        'response_schema': getattr(action, 'response_schema', {}),
                        'tags': getattr(action, 'tags', [])
                    }
                    app_details['tools'].append(tool_info)
                
            except Exception as e:
                print(f"Error getting tools for {app_name}: {e}")
                app_details['tools'] = [{'error': f'Could not retrieve tools: {str(e)}'}]
            
            toolkits_data[app_name] = app_details
        
        print(f"\nCompleted processing {processed_count} toolkits with {total_tools_count} total tools")
        return toolkits_data
        
    except Exception as e:
        print(f"Error fetching toolkits: {e}")
        return {}

def generate_markdown(toolkits_data: Dict[str, Any]) -> str:
    """Generate markdown documentation from toolkits data."""
    
    md_content = """# Composio Toolkits and Tools Reference

This document provides a comprehensive overview of all available Composio toolkits and their tools.
Generated for LLM context and reference.

## Table of Contents

"""
    
    # Generate table of contents
    for toolkit_key, toolkit in toolkits_data.items():
        md_content += f"- [{toolkit['name']}](#{toolkit_key.lower().replace('_', '-')})\n"
    
    md_content += "\n---\n\n"
    
    # Generate detailed sections
    for toolkit_key, toolkit in toolkits_data.items():
        md_content += f"## {toolkit['name']}\n\n"
        md_content += f"**Key:** `{toolkit['key']}`\n\n"
        
        if toolkit['description']:
            md_content += f"**Description:** {toolkit['description']}\n\n"
        
        if toolkit['categories']:
            md_content += f"**Categories:** {', '.join(toolkit['categories'])}\n\n"
        
        if toolkit['tools']:
            md_content += f"### Available Tools ({len(toolkit['tools'])} tools)\n\n"
            
            for i, tool in enumerate(toolkit['tools'], 1):
                if 'error' in tool:
                    md_content += f"#### {i}. Error retrieving tools\n"
                    md_content += f"{tool['error']}\n\n"
                    continue
                
                
                md_content += f"#### {i}. {tool.get('display_name', tool.get('name', 'Unknown'))}\n\n"
                md_content += f"**Action Name:** `{tool.get('name', 'Unknown')}`\n\n"
                
                if tool.get('description'):
                    md_content += f"**Description:** {tool['description']}\n\n"
                
                if tool.get('tags'):
                    md_content += f"**Tags:** {', '.join(tool['tags'])}\n\n"
                
                # Parameters
                if tool.get('parameters') and isinstance(tool['parameters'], dict):
                    md_content += "**Parameters:**\n"
                    if 'properties' in tool['parameters']:
                        for param_name, param_info in tool['parameters']['properties'].items():
                            param_type = param_info.get('type', 'unknown')
                            param_desc = param_info.get('description', 'No description')
                            required = param_name in tool['parameters'].get('required', [])
                            req_marker = " *(required)*" if required else ""
                            md_content += f"- `{param_name}` ({param_type}){req_marker}: {param_desc}\n"
                    md_content += "\n"
                
                # Response schema
                if tool.get('response_schema') and isinstance(tool['response_schema'], dict):
                    md_content += "**Response Schema:**\n"
                    if 'properties' in tool['response_schema']:
                        for resp_name, resp_info in tool['response_schema']['properties'].items():
                            resp_type = resp_info.get('type', 'unknown')
                            resp_desc = resp_info.get('description', 'No description')
                            md_content += f"- `{resp_name}` ({resp_type}): {resp_desc}\n"
                    md_content += "\n"
                
                md_content += "---\n\n"
        else:
            md_content += "### No tools available\n\n"
        
        md_content += "\n"
    
    # Calculate stats
    total_toolkits = len(toolkits_data)
    total_tools = sum(len(t.get('tools', [])) for t in toolkits_data.values())
    
    # Add footer
    md_content += f"""
---

*This documentation was automatically generated from the Composio API.*
*Total toolkits: {total_toolkits}*
*Total tools: {total_tools}*
*Generated on: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}*
"""
    
    return md_content

def main():
    """Main function to orchestrate the dump process."""
    print("Starting Composio toolkits and tools dump...")
    
    # Install Composio if needed
    install_composio()
    
    # Fetch all toolkits and tools
    print("Fetching toolkits and tools...")
    toolkits_data = get_all_toolkits_and_tools()
    
    if not toolkits_data:
        print("No toolkits data retrieved. Exiting.")
        return
    
    print(f"Retrieved {len(toolkits_data)} toolkits")
    
    # Generate markdown
    print("Generating markdown documentation...")
    markdown_content = generate_markdown(toolkits_data)
    
    # Write to file
    output_file = "composio_toolkits_reference.md"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(markdown_content)
    
    print(f"Documentation generated successfully: {output_file}")
    
    # Also save raw data as JSON for reference
    json_file = "composio_toolkits_raw_data.json"
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(toolkits_data, f, indent=2, default=str)
    
    print(f"Raw data saved: {json_file}")

if __name__ == "__main__":
    main()
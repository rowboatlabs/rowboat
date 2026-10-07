# Search Screenpipe history from Rowboat

Connect [Screenpipe](https://github.com/screenpipe/screenpipe) as an optional MCP
tool to retrieve desktop text and meeting transcripts while working in Rowboat.
This uses Rowboat's existing external-tools support; it does not add an automatic
importer or copy your entire recording history into a Space.

## Start the local bridge

Keep the Screenpipe desktop app running on the same computer as the MCP client.
You need Node.js and `npx` on your PATH. Obtain your local API key with
`screenpipe auth token`, or use the key configured by the desktop app. Put the
key in `SCREENPIPE_LOCAL_API_KEY` in the terminal where you start the bridge.
Do not paste it into a chat or commit it to a repository.

```bash
npx -y screenpipe-mcp@0.20.2 --http --port 3031
```

The bridge binds to loopback by default and forwards searches to Screenpipe on
port 3030. Leave `--listen-on-lan` off for this setup. If port 3031 is occupied,
choose another free port and use it in the client configuration too.

The HTTP transport exposes the `search_content` tool. Use a narrow time range,
a small limit, and a specific query; an empty result means no matching evidence
was returned. The full stdio tool set has different tool names, so inspect the
connected server's tools rather than substituting a stdio example.

## Configure Rowboat

Open **Settings → MCP Servers**. Add `screenpipe` alongside existing entries in
`mcpServers`, then save:

```json
{
  "mcpServers": {
    "screenpipe": {
      "url": "http://127.0.0.1:3031/mcp"
    }
  }
}
```

Keep Rowboat, the bridge and Screenpipe on the same computer. A remote Harbor
server does not make your computer's loopback endpoint reachable from elsewhere.

## Check the connection

Ask Rowboat to list the connected Screenpipe tools. It should find
`search_content`. Search for a distinctive phrase in a recent recording, bounded
to that time window. Check the returned timestamp and source against Screenpipe
before using the result in a meeting brief or project update.

If the tool is missing, confirm that the bridge is still running and that the URL
ends in `/mcp`. For authentication failures, verify the recorder's API key in the
bridge environment. No results is different from a connection failure: broaden
the time range or confirm Screenpipe recorded the relevant app or audio source.

## Save only the context you choose

A search result is historical evidence. It does not authorize an action in the
recorded application, and it is not proof that an inferred task succeeded.
Review any summary before asking Rowboat to save it to a local note or shared
Space. Keep timestamps and source references with the saved text.

Search results enter Rowboat's agent context and may be sent to its configured
model provider. Saving to a shared Space makes that selected content available
under the Space's access rules. Removing a Screenpipe recording does not remove
copies already saved in Rowboat.

To disconnect, remove the `screenpipe` entry in Settings and stop the bridge
process you started. Leave unrelated MCP entries and the Screenpipe recorder
unchanged.

[Screenpipe MCP reference](https://github.com/screenpipe/screenpipe/tree/main/packages/screenpipe-mcp)

#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { app, updateState } from '../dist/app.js';
import { importExample, listAvailableExamples } from '../dist/application/examples/import-example.js';

yargs(hideBin(process.argv))

    .command(
        "$0",
        "Run rowboatx",
        (y) => y
            .option("agent", {
                type: "string",
                description: "The agent to run (defaults to copilot)",
            })
            .option("run_id", {
                type: "string",
                description: "Continue an existing run",
            })
            .option("input", {
                type: "string",
                description: "The input to the agent",
            })
            .option("no-interactive", {
                type: "boolean",
                description: "Do not interact with the user",
                default: false,
            })
            .option("example", {
                type: "string",
                description: "Import an example workflow by name (use 'all' for every example) before running",
            }),
        async (argv) => {
            let agent = argv.agent ?? "copilot";
            if (argv.example) {
                const requested = String(argv.example).trim();
                const isAll = requested.toLowerCase() === "all";
                try {
                    const examplesToImport = isAll ? await listAvailableExamples() : [requested];
                    if (examplesToImport.length === 0) {
                        console.error("No packaged examples are available to import.");
                        process.exit(1);
                    }
                    for (const exampleName of examplesToImport) {
                        const imported = await importExample(exampleName);
                        const agentList = imported.importedAgents.join(", ");
                        console.error(`Imported example '${exampleName}' with agents: ${agentList}`);
                        console.error(`Primary agent: ${imported.entryAgent}`);
                        if (imported.addedServers.length > 0) {
                            console.error(`Configured new MCP servers: ${imported.addedServers.join(", ")}`);
                        }
                        if (imported.skippedServers.length > 0) {
                            console.error(`Skipped existing MCP servers (already configured): ${imported.skippedServers.join(", ")}`);
                        }
                    }
                } catch (error) {
                    console.error(error?.message ?? error);
                    process.exit(1);
                }
                console.error("Examples imported. Re-run rowboatx without --example (or with --agent <name>) when you're ready to chat.");
                return;
            }
            await app({
                agent,
                runId: argv.run_id,
                input: argv.input,
                noInteractive: argv.noInteractive,
            });
        }
    )
    .command(
        "update-state <agent> <run_id>",
        "Update state for a run",
        (y) => y
            .positional("agent", {
                type: "string",
                description: "The agent to run",
            })
            .positional("run_id", {
                type: "string",
                description: "The run id to update",
            }),
        (argv) => {
            updateState(argv.agent, argv.run_id);
        }
    )
    .parse();

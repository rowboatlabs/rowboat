#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { app, modelConfig, importExample, listExamples, exportWorkflow } from '../dist/app.js';
import { runTui } from '../dist/tui/index.js';

yargs(hideBin(process.argv))

    .command(
        "$0",
        "Run rowboatx",
        (y) => y
            .option("agent", {
                type: "string",
                description: "The agent to run",
                default: "copilot",
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
            }),
        (argv) => {
            app({
                agent: argv.agent,
                runId: argv.run_id,
                input: argv.input,
                noInteractive: argv.noInteractive,
            });
        }
    )
    .command(
        "ui",
        "Launch the interactive Rowboat dashboard",
        (y) => y
            .option("server-url", {
                type: "string",
                description: "Rowboat server base URL",
            }),
        (argv) => {
            runTui({
                serverUrl: argv.serverUrl,
            });
        }
    )
    .command(
        "import",
        "Import an example workflow (--example) or custom workflow from file (--file)",
        (y) => y
            .option("example", {
                type: "string",
                description: "Name of built-in example to import",
            })
            .option("file", {
                type: "string",
                description: "Path to custom workflow JSON file",
            })
            .check((argv) => {
                if (!argv.example && !argv.file) {
                    throw new Error("Either --example or --file must be provided");
                }
                if (argv.example && argv.file) {
                    throw new Error("Cannot use both --example and --file at the same time");
                }
                return true;
            }),
        async (argv) => {
            try {
                if (argv.example) {
                    await importExample(String(argv.example).trim());
                } else if (argv.file) {
                    await importExample(undefined, String(argv.file).trim());
                }
            } catch (error) {
                console.error("Error:", error?.message ?? error);
                process.exit(1);
            }
        }
    )
    .command(
        "list-examples",
        "List all available example workflows",
        (y) => y,
        async () => {
            try {
                const examples = await listExamples();
                if (examples.length === 0) {
                    console.error("No packaged examples are available to list.");
                    return;
                }
                for (const example of examples) {
                    console.log(example);
                }
            } catch (error) {
                console.error(error?.message ?? error);
                process.exit(1);
            }
        }
    )
    .command(
        "export",
        "Export a workflow with all dependencies (outputs to stdout)",
        (y) => y
            .option("agent", {
                type: "string",
                description: "Entry agent name to export",
                demandOption: true,
            }),
        async (argv) => {
            try {
                await exportWorkflow(String(argv.agent).trim());
            } catch (error) {
                console.error("Error:", error?.message ?? error);
                process.exit(1);
            }
        }
    )
    .command(
        "model-config",
        "Select model",
        (y) => y,
        (argv) => {
            modelConfig();
        }
    )
    .parse();

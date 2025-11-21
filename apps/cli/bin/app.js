#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { app, modelConfig, updateState, importExample, listExamples } from '../dist/app.js';

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
        "sync-example <example>",
        "Import an example workflow by name",
        (y) => y.positional("example", {
            type: "string",
            description: "The example to import",
        }),
        async (argv) => {
            try {
                await importExample(String(argv.example).trim());
            } catch (error) {
                console.error("Error:", error?.message ?? error);
                process.exit(1);
            }
        }
    )
    .command(
        "list-example",
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
        "model-config",
        "Select model",
        (y) => y,
        (argv) => {
            modelConfig();
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

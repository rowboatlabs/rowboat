#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { app } from '../dist/app.js';

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
    .parse();
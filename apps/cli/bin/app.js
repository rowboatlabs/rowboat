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
        }),
        (argv) => {
            app({
                agent: argv.agent,
                runId: argv.run_id,
                input: argv.input,
            });
        }
    )
    .parse();
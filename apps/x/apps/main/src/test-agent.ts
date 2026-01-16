import * as runsCore from '@x/core/dist/runs/runs.js';
import { bus } from '@x/core/dist/runs/bus.js';

async function main() {
    const { id } = await runsCore.createRun({
        // this will expect an agent file to exist at ~/.rowboat/agents/test-agent.md
        agentId: 'test-agent',
    });
    console.log(`created run: ${id}`);

    await bus.subscribe(id, async (event) => {
        console.log(`got event: ${JSON.stringify(event)}`);
    });

    const msgId = await runsCore.createMessage(id, 'whats your name?');
    console.log(`created message: ${msgId}`);
}

main();
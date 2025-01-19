'use client';

import { Action } from "./workflow_editor";
import { Workflow } from "@/app/lib/types"
import { Dispatch } from "react";
import { z } from "zod";
import { stringify, parse } from "yaml";
import { Textarea } from "@nextui-org/react";
import { Pane } from "./pane";

export function CodeEditor({ workflow, dispatch }: { workflow: z.infer<typeof Workflow>, dispatch: Dispatch<Action> }) {
    const yaml = stringify(workflow);

    return <Pane
        title="Code Editor"
        actions={[]}
    >
        <Textarea
            className="w-full"
            value={yaml}
            onChange={(e) => {
                const newWorkflow = parse(e.target.value);
                const valid = Workflow.safeParse(newWorkflow);
                if (valid.success) {
                    dispatch({ type: "code_update", workflow: valid.data });
                }
            }}
        />
    </Pane>;
}

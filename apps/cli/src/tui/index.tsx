import React from "react";
import { render } from "ink";
import { RowboatTui } from "./ui.js";

export function runTui({ serverUrl }: { serverUrl?: string }) {
    const baseUrl = serverUrl ?? process.env.ROWBOATX_SERVER_URL ?? "http://127.0.0.1:3000";
    render(<RowboatTui serverUrl={baseUrl} />);
}

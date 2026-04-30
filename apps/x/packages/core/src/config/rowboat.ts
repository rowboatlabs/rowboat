import { z } from "zod";
import { RowboatApiConfig } from "@x/shared/dist/rowboat-account.js";
import { API_URL } from "./env.js";

let cached: z.infer<typeof RowboatApiConfig> | null = null;

export async function getRowboatConfig(): Promise<z.infer<typeof RowboatApiConfig>> {
  if (cached) {
    return cached;
  }
  const response = await fetch(`${API_URL}/v1/config`);
  const data = RowboatApiConfig.parse(await response.json());
  cached = data;
  return data;
}
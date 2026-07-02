import { getDefaultModelAndProvider } from "./defaults.js";

export interface IDefaultModelResolver {
    resolve(): Promise<{ model: string; provider: string }>;
}

export class DefaultModelResolver implements IDefaultModelResolver {
    resolve(): Promise<{ model: string; provider: string }> {
        return getDefaultModelAndProvider();
    }
}

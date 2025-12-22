declare module "turndown" {
  export default class TurndownService {
    constructor(options?: unknown);
    addRule(name: string, rule: unknown): void;
    use(plugin: unknown): void;
    turndown(html: string): string;
  }
}

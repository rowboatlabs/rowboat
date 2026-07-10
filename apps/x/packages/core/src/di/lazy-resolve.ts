// Lazily import the DI container and resolve one token. Use this instead of
// a static `import container from "./container.js"` when the importing
// module must not add a static edge into the DI graph (the container's
// module tree is large, and some importers — the agent registry, tool
// handlers, capability availability checks — are themselves imported while
// the container initializes). One helper holds the pattern and this
// rationale instead of hand-rolled copies at every call site.
export async function lazyResolve<T>(token: string): Promise<T> {
    const { default: container } = await import("./container.js");
    return container.resolve<T>(token);
}

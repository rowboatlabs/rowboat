import { z } from 'zod';

// ============================================================================
// Workspace Filesystem Schema Definitions
// ============================================================================

// All paths are workspace-relative POSIX strings
export const RelPath = z.string().min(1);

export const NodeKind = z.enum(['file', 'dir']);

export const Encoding = z.enum(['utf8', 'base64', 'binary']);

export const Stat = z.object({
  kind: NodeKind,
  size: z.number().min(0),
  mtimeMs: z.number().min(0),
  ctimeMs: z.number().min(0),
  isSymlink: z.boolean().optional(),
});

export const DirEntry = z.object({
  name: z.string(),
  path: RelPath,
  kind: NodeKind,
  stat: z
    .object({
      size: z.number().min(0),
      mtimeMs: z.number().min(0),
    })
    .optional(),
});

export const ReaddirOptions = z.object({
  recursive: z.boolean().optional(),
  includeStats: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  allowedExtensions: z.array(z.string()).optional(),
});

export const ReadFileResult = z.object({
  path: RelPath,
  encoding: Encoding,
  data: z.string(),
  stat: Stat,
  etag: z.string(),
});

export const WriteFileOptions = z.object({
  encoding: Encoding.optional(),
  atomic: z.boolean().optional(),
  mkdirp: z.boolean().optional(),
  expectedEtag: z.string().optional(),
});

export const WriteFileResult = ReadFileResult.pick({
  path: true,
  stat: true,
  etag: true,
});

export const RemoveOptions = z.object({
  recursive: z.boolean().optional(),
  trash: z.boolean().optional(),
});

export const WorkspaceChangeEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('created'),
    path: RelPath,
    kind: NodeKind.optional(),
  }),
  z.object({
    type: z.literal('deleted'),
    path: RelPath,
    kind: NodeKind.optional(),
  }),
  z.object({
    type: z.literal('changed'),
    path: RelPath,
    kind: NodeKind.optional(),
  }),
  z.object({
    type: z.literal('moved'),
    from: RelPath,
    to: RelPath,
    kind: NodeKind.optional(),
  }),
  z.object({
    type: z.literal('bulkChanged'),
    paths: z.array(RelPath).optional(),
  }),
]);
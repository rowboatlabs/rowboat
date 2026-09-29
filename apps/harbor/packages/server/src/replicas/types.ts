import type { ReplicasTask } from '@rowboat/spaces-protocol';
export interface ReplicasConnection {
  sealedKey: string;
  botMemberId: string;
  configuredBy: string;
  codingAgent: string;
}
export interface ReplicasSpaceConfig {
  botMemberId: string;
  enabled: boolean;
  environmentId: string | null;
}
export interface ResolvedReplicasConnection extends ReplicasConnection {
  enabled: boolean;
  environmentId: string | null;
}
export interface ReplicasTaskRecord extends Omit<ReplicasTask, 'pending' | 'cancellableMessageIds'> {
  queue: Array<{ messageId: string; memberId: string; offset: number; planMode: boolean; environmentSelected?: boolean }>;
  active: { messageId: string; memberId: string; offset: number; text: string; planMode: boolean } | null;
  deliveredOffset: number;
  forkContext?: string;
  notice: string | null;
}

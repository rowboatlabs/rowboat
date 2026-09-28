import type { ReplicasTask } from '@rowboat/spaces-protocol';
export interface ReplicasConnection {
  sourceSpaceId?: string;
  enabled: boolean;
  sealedKey: string;
  botMemberId: string;
  configuredBy: string;
  environmentId: string | null;
  codingAgent: string;
}
export interface ReplicasTaskRecord extends Omit<ReplicasTask, 'pending'> {
  queue: Array<{ messageId: string; memberId: string; offset: number; planMode: boolean; environmentSelected?: boolean }>;
  active: { messageId: string; memberId: string; offset: number; text: string; planMode: boolean } | null;
  deliveredOffset: number;
  forkContext?: string;
  notice: string | null;
}

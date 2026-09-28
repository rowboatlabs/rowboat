import { afterEach, describe, expect, it, vi } from 'vitest';
import { replicasApi, summarizeConversation, summarizeCodexTurns } from '../src/replicas/api.js';

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown) => new Response(JSON.stringify(body), {status:200});

describe('Replicas public API contract', () => {
  it('creates with the selected environment, reads the exact chat, and sends follow-ups to it', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(response({replica:{id:'ws',status:'active'}}))
      .mockResolvedValueOnce(response({replica:{id:'ws',chats:[{id:'other',provider:'codex'},{id:'shared',provider:'claude'}]}}))
      .mockResolvedValueOnce(response({status:'sent',chat_id:'shared'}));
    vi.stubGlobal('fetch', mock);
    const api = replicasApi('secret');
    expect(await api.create({name:'task',environmentId:'env',codingAgent:'claude',message:'Build it',planMode:true})).toMatchObject({id:'ws',chatId:null,url:null});
    const workspace = await api.workspace('ws','claude');
    expect(workspace.chatId).toBe('shared');
    await api.send('ws',workspace.chatId!,'Explain it',false);
    const sent = JSON.parse(mock.mock.calls[2]![1].body);
    expect(sent).toMatchObject({chat_id:'shared',message:'Explain it',plan_mode:false});
    expect(mock.mock.calls[0]![1].headers.Authorization).toBe('Bearer secret');
    expect(mock.mock.calls[0]![1].redirect).toBe('error');
  });
  it('paginates persisted history back to the request before accepting the result', async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(response({events:[{type:'claude-result',payload:{result:'Tests passed'}}],beforeCursor:'opaque'}))
      .mockResolvedValueOnce(response({events:[{type:'claude-user',payload:{message:{content:[{type:'text',text:'[Spaces request q1] Implement'}]}}}],beforeCursor:null}));
    vi.stubGlobal('fetch',mock);
    expect(await replicasApi('secret').history('ws','shared','q1')).toEqual({requestSeen:true,finished:true,text:'Tests passed'});
    expect(mock.mock.calls[1]![0]).toContain('chat_id=shared');
    expect(mock.mock.calls[1]![0]).toContain('beforeCursor=opaque');
  });
  it('reads Codex structured turns instead of waiting for Claude event names', () => {
    expect(summarizeCodexTurns([{status:'completed',items:[
      {type:'userMessage',content:[{type:'text',text:'[Spaces request q1] Explain'}]},
      {type:'agentMessage',text:'Because retries are bounded.'},
    ]}], 'q1')).toEqual({requestSeen:true,finished:true,text:'Because retries are bounded.'});
  });
  it('does not report the answer to a different dashboard request as this thread’s answer', () => {
    const user = (text:string) => ({type:'claude-user',payload:{message:{content:text}}});
    const result = (text:string) => ({type:'claude-result',payload:{result:text}});
    expect(summarizeConversation([user('[Spaces request q1]'),result('Our answer'),user('Different task'),result('Other answer')], 'q1').text).toBe('Our answer');
  });
  it('does not guess between two chats using the same provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({replica:{id:'ws',chats:[{id:'first',provider:'claude'},{id:'second',provider:'claude'}]}})));
    expect((await replicasApi('secret').workspace('ws', 'claude')).chatId).toBeNull();
  });
  it('distinguishes a failed turn from successful completion', () => {
    expect(summarizeCodexTurns([{status:'failed',items:[{type:'userMessage',content:[{type:'text',text:'[Spaces request q1]'}]}]}], 'q1')).toMatchObject({requestSeen:true,finished:true,failed:true});
    expect(summarizeConversation([
      {type:'claude-user',payload:{message:{content:'[Spaces request q1]'}}},
      {type:'claude-result',payload:{is_error:true,result:'Failed'}},
    ], 'q1')).toMatchObject({requestSeen:true,finished:true,failed:true,text:'Failed'});
  });

});

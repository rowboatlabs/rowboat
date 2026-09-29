import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { noteReplicasRequestSent } from './use-replicas-config'
import { ReplicasComposerOptions, ReplicasHeaderButton, ReplicasSettings, ReplicasThreadStatus } from './replicas-panel'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const invoke = vi.fn()
const config = { enabled:true, configured:true, canConfigure:true, botMemberId:'bot', environmentId:'env', codingAgent:'claude', direct:false, error:null, environments:[{id:'env',name:'App'}] }
beforeEach(() => {
    invoke.mockReset().mockImplementation(async (name:string) => name === 'spaces:getReplicasTask' ? {task:null} : config)
    Object.defineProperty(window, 'ipc', {value:{invoke}, configurable:true})
})
afterEach(cleanup)

it('makes plan mode and the environment explicit options on an addressed message', () => {
    const onChange = vi.fn()
    render(<ReplicasComposerOptions config={config} options={{environmentId:'env'}} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Plan first'))
    expect(onChange).toHaveBeenLastCalledWith({environmentId:'env',planMode:true})
})

it('lets another teammate inspect the shared task and fork it', async () => {
    invoke.mockImplementation(async (name:string) => name === 'spaces:getReplicasTask'
        ? {task:{threadRootId:'root',status:'running',pending:2,url:'https://app.replicas.dev/test',cancellableMessageIds:[],error:null}} : config)
    render(<ReplicasThreadStatus orgId="org" spaceId="space" threadRootId="root" />)
    expect(await screen.findByText('Working · 1 more queued')).toBeTruthy()
    fireEvent.click(screen.getByText('Fork task'))
    fireEvent.change(screen.getByLabelText('New task instructions'), {target:{value:'Investigate independently'}})
    fireEvent.click(screen.getByText('Start separate task'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:actOnReplicasTask', {orgId:'org',spaceId:'space',rootMessageId:'root',operation:{action:'fork',messageId:'root',body:'Investigate independently'}}))
})

it('explains shared billing before connecting and confirms once connected', async () => {
    const onSaved = vi.fn(async () => {})
    render(<ReplicasSettings orgId="org" spaceId="space" config={{...config,enabled:false,configured:false}} onSaved={onSaved} />)
    expect(screen.getByText(/Everyone in this Space can start and steer work/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Replicas API key'), {target:{value:'test-secret'}})
    fireEvent.click(screen.getByText('Connect Replicas'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:configureReplicas', {orgId:'org',spaceId:'space',config:{enabled:true,apiKey:'test-secret',environmentId:'env'}}))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
})

it('shows a connected Space its status and replaces the key on request', async () => {
    render(<ReplicasSettings orgId="org" spaceId="space" config={config} onSaved={vi.fn(async () => {})} />)
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.queryByLabelText('Replicas API key')).toBeNull()
    fireEvent.click(screen.getByText('Replace API key'))
    fireEvent.change(screen.getByLabelText('Replicas API key'), {target:{value:'next-secret'}})
    fireEvent.click(screen.getByText('Save new key'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:configureReplicas', {orgId:'org',spaceId:'space',config:{enabled:true,apiKey:'next-secret',environmentId:'env'}}))
    await waitFor(() => expect(screen.queryByLabelText('Replicas API key')).toBeNull())
})

it('keeps connection repair available when upstream is unavailable', () => {
    render(<ReplicasSettings orgId="org" spaceId="space" config={{...config,error:'Replicas could not be reached.'}} onSaved={vi.fn(async () => {})} />)
    expect(screen.getByText('Replicas could not be reached.')).toBeTruthy()
    expect(screen.getByLabelText('Replicas API key')).toBeTruthy()
})

it('shows members what Replicas does without the key controls', () => {
    render(<ReplicasSettings orgId="org" spaceId="space" config={{...config,canConfigure:false}} onSaved={vi.fn(async () => {})} />)
    expect(screen.getByText(/Mention/)).toBeTruthy()
    expect(screen.queryByLabelText('Replicas API key')).toBeNull()
})

it('hides the header entry from members of an unconnected Space and offers setup to admins', async () => {
    invoke.mockResolvedValue({...config, enabled:false, configured:false, canConfigure:false, botMemberId:null})
    const view = render(<ReplicasHeaderButton orgId="org" spaceId="space" />)
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(screen.queryByTitle(/Replicas/)).toBeNull()
    invoke.mockResolvedValue({...config, enabled:false, configured:false, canConfigure:true, botMemberId:null})
    view.rerender(<ReplicasHeaderButton orgId="org" spaceId="other" />)
    expect(await screen.findByTitle('Set up Replicas, a cloud coding agent for this Space')).toBeTruthy()
})

it('offers Cancel for the caller’s queued requests while retaining the running task link', async () => {
    const task = { threadRootId: 'root', status: 'running', pending: 2, url: null, cancellableMessageIds: ['queued'], error: null }
    invoke.mockImplementation(async (name: string) => name === 'spaces:getReplicasTask' ? { task }
        : name === 'spaces:actOnReplicasTask' ? { task: { ...task, pending: 1, cancellableMessageIds: [] } } : config)
    render(<ReplicasThreadStatus orgId="org" spaceId="space" threadRootId="root" />)
    fireEvent.click(await screen.findByText('Cancel queued request'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:actOnReplicasTask', {
        orgId: 'org', spaceId: 'space', rootMessageId: 'root', operation: { action: 'cancel', messageId: 'queued' },
    }))
    await waitFor(() => expect(screen.queryByText('Cancel queued request')).toBeNull())
    expect(screen.getByText('Open in Replicas').closest('a')?.getAttribute('href')).toBe('https://app.replicas.dev')
})

it('asks which environment to use with one click per environment, and hides links until work starts', async () => {
    const task = { threadRootId: 'root', status: 'select_environment', pending: 1, url: null, workspaceId: null, cancellableMessageIds: ['m1'], error: null }
    invoke.mockImplementation(async (name: string) => name === 'spaces:getReplicasTask' ? { task }
        : name === 'spaces:actOnReplicasTask' ? { task: { ...task, status: 'sending' } } : config)
    render(<ReplicasThreadStatus orgId="org" spaceId="space" threadRootId="root" />)
    expect(await screen.findByText('Where should Replicas work?')).toBeTruthy()
    expect(screen.queryByText('Open in Replicas')).toBeNull()
    expect(screen.queryByText('Fork task')).toBeNull()
    fireEvent.click(screen.getByText('App'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:actOnReplicasTask', {
        orgId: 'org', spaceId: 'space', rootMessageId: 'root', operation: { action: 'select_environment', environmentId: 'env' },
    }))
})

it('lets an admin set the Space default environment', async () => {
    const onSaved = vi.fn(async () => {})
    render(<ReplicasSettings orgId="org" spaceId="space" config={{...config,environmentId:null,environments:[{id:'env',name:'App'},{id:'all',name:'global'}]}} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Default environment'), {target:{value:'env'}})
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:configureReplicas', {orgId:'org',spaceId:'space',config:{enabled:true,environmentId:'env'}}))
    expect(onSaved).toHaveBeenCalled()
})

it('shows a just-sent follow-up as queued instead of the previous run’s done state', async () => {
    const task = { threadRootId: 'root', status: 'idle', pending: 0, url: null, workspaceId: 'w', cancellableMessageIds: [], error: null }
    invoke.mockImplementation(async (name: string) => name === 'spaces:getReplicasTask' ? { task } : config)
    render(<ReplicasThreadStatus orgId="org" spaceId="space" threadRootId="root" />)
    expect(await screen.findByText('Done')).toBeTruthy()
    act(() => noteReplicasRequestSent('root'))
    expect(await screen.findByText('Queued')).toBeTruthy()
    expect(screen.queryByText('Done')).toBeNull()
})

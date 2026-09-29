import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ReplicasPanel } from './replicas-panel'

vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
const invoke = vi.fn()
const config = { enabled:true, configured:true, canConfigure:true, botMemberId:'bot', environmentId:'env', codingAgent:'claude', direct:false, error:null, environments:[{id:'env',name:'App'}] }
const props = () => ({orgId:'org',spaceId:'space',onMention:vi.fn(),onOptions:vi.fn(),onConnection:vi.fn()})
beforeEach(() => {
    invoke.mockReset().mockImplementation(async (name:string) => name === 'spaces:getReplicasTask' ? {task:null} : config)
    Object.defineProperty(window, 'ipc', {value:{invoke}, configurable:true})
})
afterEach(cleanup)
it('addresses the shared member and makes plan mode an explicit option', async () => {
    const p = props()
    render(<ReplicasPanel {...p} />)
    await screen.findByText('Ask Replicas')
    fireEvent.click(screen.getByLabelText('Plan first'))
    fireEvent.click(screen.getByText('Ask Replicas'))
    expect(p.onMention).toHaveBeenCalledWith('bot')
    expect(p.onOptions).toHaveBeenLastCalledWith({environmentId:'env',planMode:true})
    expect(p.onConnection).toHaveBeenCalledWith({memberId:'bot',direct:false})
})
it('lets another teammate inspect the shared task and fork it', async () => {
    invoke.mockImplementation(async (name:string) => name === 'spaces:getReplicasTask' ? {task:{threadRootId:'root',status:'running',pending:2,url:'https://app.replicas.dev/test'}} : config)
    render(<ReplicasPanel {...props()} threadRootId="root" />)
    expect(await screen.findByText('running · 1 queued')).toBeTruthy()
    fireEvent.click(screen.getByText('Fork task'))
    fireEvent.change(screen.getByLabelText('New task instructions'), {target:{value:'Investigate independently'}})
    fireEvent.click(screen.getByText('Start separate task'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:actOnReplicasTask', {orgId:'org',spaceId:'space',rootMessageId:'root',operation:{action:'fork',messageId:'root',body:'Investigate independently'}}))
})
it('explains shared billing before connecting and clears the key after save', async () => {
    render(<ReplicasPanel {...props()} />)
    fireEvent.click(await screen.findByText('Settings'))
    expect(screen.getByText(/Everyone in this Space can start and steer work/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Replicas API key'), {target:{value:'test-secret'}})
    fireEvent.click(screen.getByText('Save connection'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:configureReplicas', {orgId:'org',spaceId:'space',config:{enabled:true,apiKey:'test-secret',environmentId:'env'}}))
    await waitFor(() => expect(screen.queryByLabelText('Replicas API key')).toBeNull())
})
it('keeps connection repair available when upstream is unavailable', async () => {
    invoke.mockResolvedValue({...config,error:'Replicas could not be reached.'})
    render(<ReplicasPanel {...props()} />)
    expect(await screen.findByText('Replicas could not be reached.')).toBeTruthy()
    fireEvent.click(screen.getByText('Settings'))
    expect(screen.getByLabelText('Replicas API key')).toBeTruthy()
})

it('refreshes a teammate’s connection on focus and clears it on a Space switch', async () => {
    const p = props()
    const view = render(<ReplicasPanel {...p} />)
    await screen.findByText('Ask Replicas')
    invoke.mockResolvedValue({...config, enabled:false, botMemberId:null})
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.queryByText('Ask Replicas')).toBeNull())
    expect(p.onConnection).toHaveBeenLastCalledWith({memberId:null,direct:false})
    invoke.mockImplementation(() => new Promise(() => {}))
    view.rerender(<ReplicasPanel {...p} spaceId="other" />)
    expect(screen.queryByLabelText('Replicas shared agent')).toBeNull()
    expect(p.onOptions).toHaveBeenLastCalledWith(undefined)
})

it('offers Cancel for the caller’s queued requests while retaining the running task link', async () => {
    const task = { threadRootId: 'root', status: 'running', pending: 2, url: null, cancellableMessageIds: ['queued'] }
    invoke.mockImplementation(async (name: string) => name === 'spaces:getReplicasTask' ? { task }
        : name === 'spaces:actOnReplicasTask' ? { task: { ...task, pending: 1, cancellableMessageIds: [] } } : config)
    render(<ReplicasPanel {...props()} threadRootId="root" />)
    fireEvent.click(await screen.findByText('Cancel queued request'))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:actOnReplicasTask', {
        orgId: 'org', spaceId: 'space', rootMessageId: 'root', operation: { action: 'cancel', messageId: 'queued' },
    }))
    await waitFor(() => expect(screen.queryByText('Cancel queued request')).toBeNull())
    expect(screen.getByText('Open in Replicas').closest('a')?.getAttribute('href')).toBe('https://app.replicas.dev')
})

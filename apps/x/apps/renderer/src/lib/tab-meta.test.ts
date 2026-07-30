import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetTabMetaForTests,
  clearTabMeta,
  getAllTabMeta,
  getTabMeta,
  reportTabMeta,
  retainTabMeta,
  subscribeTabMeta,
} from './tab-meta'

describe('tab-meta store', () => {
  beforeEach(() => {
    __resetTabMetaForTests()
  })

  describe('reportTabMeta (merge)', () => {
    it('merges fields across separate reports', () => {
      reportTabMeta('t1', { title: 'Hello' })
      reportTabMeta('t1', { busy: true })
      expect(getTabMeta('t1')).toEqual({ title: 'Hello', busy: true })
    })

    it('overwrites only the keys present in the patch', () => {
      reportTabMeta('t1', { title: 'Hello', busy: true })
      reportTabMeta('t1', { title: 'World' })
      expect(getTabMeta('t1')).toEqual({ title: 'World', busy: true })
    })

    it('an explicitly-undefined key withdraws that field', () => {
      const listener = vi.fn()
      reportTabMeta('t1', { title: 'Hello', busy: true })
      subscribeTabMeta(listener)
      reportTabMeta('t1', { title: undefined })
      expect(listener).toHaveBeenCalledTimes(1)
      expect(getTabMeta('t1').title).toBeUndefined()
      expect(getTabMeta('t1').busy).toBe(true)
    })

    it('keeps tabs independent', () => {
      reportTabMeta('t1', { title: 'One' })
      reportTabMeta('t2', { title: 'Two' })
      expect(getTabMeta('t1').title).toBe('One')
      expect(getTabMeta('t2').title).toBe('Two')
    })
  })

  describe('dedupe', () => {
    it('does not emit when reported meta is identical', () => {
      const listener = vi.fn()
      reportTabMeta('t1', { title: 'Hello', busy: true })
      subscribeTabMeta(listener)
      // A second instance of the same chat reports the same values.
      reportTabMeta('t1', { title: 'Hello', busy: true })
      reportTabMeta('t1', { title: 'Hello' })
      expect(listener).not.toHaveBeenCalled()
    })

    it('does not create an entry for an all-undefined report', () => {
      const listener = vi.fn()
      subscribeTabMeta(listener)
      reportTabMeta('t1', { title: undefined, busy: undefined })
      reportTabMeta('t2', {})
      expect(listener).not.toHaveBeenCalled()
      expect(getAllTabMeta().size).toBe(0)
    })

    it('keeps snapshot references stable across no-op reports', () => {
      reportTabMeta('t1', { title: 'Hello' })
      const all = getAllTabMeta()
      const entry = getTabMeta('t1')
      reportTabMeta('t1', { title: 'Hello' })
      expect(getAllTabMeta()).toBe(all)
      expect(getTabMeta('t1')).toBe(entry)
    })

    it('reuses untouched entries when another tab changes', () => {
      reportTabMeta('t1', { title: 'One' })
      const entry = getTabMeta('t1')
      const all = getAllTabMeta()
      reportTabMeta('t2', { title: 'Two' })
      // The map snapshot is rebuilt (change happened) …
      expect(getAllTabMeta()).not.toBe(all)
      // … but t1's entry object is reused, so its consumers see no change.
      expect(getTabMeta('t1')).toBe(entry)
    })

    it('returns a stable empty meta for unknown tabs', () => {
      expect(getTabMeta('nope')).toBe(getTabMeta('nope'))
    })
  })

  describe('clearTabMeta', () => {
    it('drops the entry and emits', () => {
      const listener = vi.fn()
      reportTabMeta('t1', { title: 'Hello' })
      subscribeTabMeta(listener)
      clearTabMeta('t1')
      expect(listener).toHaveBeenCalledTimes(1)
      expect(getTabMeta('t1')).toEqual({})
      expect(getAllTabMeta().has('t1')).toBe(false)
    })

    it('is a silent no-op for unknown tabs', () => {
      const listener = vi.fn()
      subscribeTabMeta(listener)
      clearTabMeta('nope')
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('subscription', () => {
    it('notifies on change and stops after unsubscribe', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeTabMeta(listener)
      reportTabMeta('t1', { title: 'Hello' })
      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
      reportTabMeta('t1', { title: 'World' })
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('retainTabMeta (refcounted lifecycle)', () => {
    it('keeps meta while another holder is live, clears on last release', () => {
      const releaseA = retainTabMeta('t1')
      const releaseB = retainTabMeta('t1')
      reportTabMeta('t1', { title: 'Hello' })

      releaseA()
      expect(getTabMeta('t1').title).toBe('Hello')

      releaseB()
      expect(getAllTabMeta().has('t1')).toBe(false)
    })

    it('release is idempotent', () => {
      const releaseA = retainTabMeta('t1')
      const releaseB = retainTabMeta('t1')
      reportTabMeta('t1', { title: 'Hello' })

      releaseA()
      releaseA() // double-release must not steal B's hold
      expect(getTabMeta('t1').title).toBe('Hello')

      releaseB()
      expect(getAllTabMeta().has('t1')).toBe(false)
    })

    it('emits when the last release clears reported meta', () => {
      const release = retainTabMeta('t1')
      reportTabMeta('t1', { title: 'Hello' })
      const listener = vi.fn()
      subscribeTabMeta(listener)
      release()
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })
})

// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AskInbox } from '../src/client/AskInbox.tsx'
import { zh } from '../src/client/locales.ts'
import type { ChannelAsk, ChannelPendingItem } from '../src/client/channel-source.ts'

afterEach(cleanup)
const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), zh[key])) as any
const asks: ChannelAsk[] = [1, 2].map(id => ({ id: `ask-${id}`, task_id: id, task_title: '配色任务', workspace_id: 10, workspace_name: '工作区3', member_id: 'sol', member_name: 'Sol', text: `问题${id}\n第一行\n第二行\n第三行`, asked_at: 1, minutes_waiting: 12 }))
const noop = async () => {}
it('shows question body inline and removes answered rows until the bar disappears', async () => {
  const sent: string[] = []
  function Inbox() {
    const [rows, setRows] = useState(asks)
    return <AskInbox asks={rows} t={t} decide={noop} retry={noop} answer={async (id, text) => { sent.push(text); setRows(rows => rows.filter(row => row.id !== id)) }} />
  }
  render(<Inbox />)
  fireEvent.click(screen.getByRole('button', { name: /待处理 2/ }))
  expect(screen.getAllByText(/#\d · 配色任务 · Sol/)).toHaveLength(2)
  expect(screen.getByText(/问题1/).textContent).toContain('第一行')
  for (const id of [1, 2]) {
    fireEvent.change(screen.getAllByRole('textbox', { name: '答复' })[0]!, { target: { value: `答${id}` } })
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: '发送' })[0]!))
    expect(screen.queryByText(new RegExp(`问题${id}`))).toBeNull()
  }
  expect(sent).toEqual(['答1', '答2'])
  expect(screen.queryByTestId('ask-inbox')).toBeNull()
})
it('renders nothing when no pending entries exist', () => {
  const { container } = render(<AskInbox asks={[]} t={t} answer={noop} decide={noop} retry={noop} />)
  expect(container.innerHTML).toBe('')
})
it('uses the original request id to approve and removes the pending copy', async () => {
  const decisions: number[] = []
  const item: ChannelPendingItem = { kind: 'approval', room_id: 10, message_id: 42, request_id: 17, task_id: 380, task_title: '权限任务', workspace_name: '工作区1', member_name: 'Sol', text: '允许执行测试？', minutes_waiting: 3 }
  function Inbox() {
    const [rows, setRows] = useState([item])
    return <AskInbox asks={[]} items={rows} t={t} answer={noop} retry={noop} decide={async id => { decisions.push(id); setRows([]) }} />
  }
  render(<Inbox />)
  fireEvent.click(screen.getByRole('button', { name: /待处理 1/ }))
  expect(screen.getByText('允许执行测试？')).toBeTruthy()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '允许' })))
  expect(decisions).toEqual([17])
  expect(screen.queryByTestId('ask-inbox')).toBeNull()
})
it('retries failed item through the existing message endpoint', async () => {
  const ids: number[] = []
  const item: ChannelPendingItem = { kind: 'failed', room_id: 10, message_id: 56, task_id: null, task_title: '', workspace_name: '工作区1', member_name: 'Sol', text: 'model unavailable', minutes_waiting: 1 }
  render(<AskInbox asks={[]} items={[item]} t={t} answer={noop} decide={noop} retry={async id => { ids.push(id) }} />)
  fireEvent.click(screen.getByRole('button', { name: /待处理 1/ }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试' })))
  expect(ids).toEqual([56])
})
it('keeps the question and draft when submission fails', async () => {
  render(<AskInbox asks={asks.slice(0, 1)} t={t} decide={noop} retry={noop} answer={async () => { throw Error('offline') }} />)
  fireEvent.click(screen.getByRole('button', { name: /待处理 1/ }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
  expect(screen.getByRole('alert').textContent).toContain('offline')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft')
})

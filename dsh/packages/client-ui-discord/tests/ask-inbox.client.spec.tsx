// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AskInbox } from '../src/client/AskInbox.tsx'
import { zh } from '../src/client/locales.ts'
import type { ChannelAsk } from '../src/client/channel-source.ts'

afterEach(cleanup)
const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), zh[key])) as any
const asks: ChannelAsk[] = [1, 2].map(id => ({ id: `ask-${id}`, task_id: id, task_title: 'Task', workspace_id: 10, workspace_name: '工作区3', member_id: 'sol', member_name: 'Sol', text: `问题${id}`, asked_at: 1, minutes_waiting: 12 }))
it('renders questions and removes each answered row until the card disappears', async () => {
  const sent: string[] = []
  function Inbox() {
    const [rows, setRows] = useState(asks)
    return <AskInbox asks={rows} t={t} answer={async (id, text) => { sent.push(text); setRows(rows => rows.filter(row => row.id !== id)) }} />
  }
  render(<Inbox />)
  expect(screen.getByText('2 个问题待答复')).toBeTruthy()
  for (const id of [1, 2]) {
    fireEvent.click(screen.getAllByRole('button', { name: '答复' })[0]!)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `答${id}` } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
    expect(screen.queryByText(`问题${id}`)).toBeNull()
  }
  expect(sent).toEqual(['答1', '答2'])
  expect(screen.queryByTestId('ask-inbox')).toBeNull()
})
it('renders nothing when no unanswered questions exist', () => {
  const { container } = render(<AskInbox asks={[]} t={t} answer={async () => {}} />)
  expect(container.innerHTML).toBe('')
})
it('keeps the question and draft when submission fails', async () => {
  render(<AskInbox asks={asks.slice(0, 1)} t={t} answer={async () => { throw Error('offline') }} />)
  fireEvent.click(screen.getByRole('button', { name: '答复' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'draft' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
  expect(screen.getByRole('alert').textContent).toContain('offline')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('draft')
  expect(screen.getByText('问题1')).toBeTruthy()
})

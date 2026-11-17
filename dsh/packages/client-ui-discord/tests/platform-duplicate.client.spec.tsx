// @vitest-environment jsdom
// 回归：同一个文件夹不能登记两次。服务端拒绝重复文件夹时返回 409，弹窗必须把这条文案留在
// 新增表单旁边、并保留用户已经填好的名字/路径/公共选择，不能静默清空或整页报错。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlatformDialog } from '../src/client/PlatformDialog.tsx'
import { zh } from '../src/client/locales.ts'
import type { ComponentProps } from 'react'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), zh[key])) as ComponentProps<typeof PlatformDialog>['t']
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const duplicate = '这个文件夹已经登记过了：旧平台'

it('keeps the typed draft and shows the 409 duplicate-folder message beside the add form', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (init?.method === 'POST') return response({ error: duplicate }, 409)
    return response({ platforms: [] })
  })
  const onChange = vi.fn()
  render(<PlatformDialog t={t} onClose={vi.fn()} onChange={onChange} />)
  await screen.findByText(zh.platformEmpty)
  fireEvent.change(screen.getByLabelText('名字'), { target: { value: '新平台' } })
  fireEvent.change(screen.getByLabelText('绝对路径'), { target: { value: '/tmp/platform-fixture' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '公共' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })))

  const posted = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({ name: '新平台', path: '/tmp/platform-fixture', is_public: true })

  const alert = screen.getByRole('alert')
  expect(alert.closest('form')).toBeTruthy()
  expect(alert.textContent).toContain('这个文件夹已经登记过了')
  expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('新平台')
  expect((screen.getByLabelText('绝对路径') as HTMLInputElement).value).toBe('/tmp/platform-fixture')
  expect((screen.getByRole('checkbox', { name: '公共' }) as HTMLInputElement).checked).toBe(true)
  expect(onChange).not.toHaveBeenCalledWith([expect.objectContaining({ name: '新平台' })])
})

it('keeps the edit draft when PATCH reports the folder is taken by another entry', async () => {
  const rows = [{ id: 'a', name: '旧平台', path: '/tmp/platform-fixture', is_public: false }]
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'PATCH') return response({ error: duplicate }, 409)
    return response(String(url).endsWith('/files') ? { files: [], truncated: false } : { platforms: rows })
  })
  render(<PlatformDialog t={t} onClose={vi.fn()} onChange={vi.fn()} />)
  await screen.findByText('旧平台 · /tmp/platform-fixture')
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByLabelText('绝对路径'), { target: { value: '/tmp/other-fixture' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })))

  const alert = screen.getByRole('alert')
  expect(alert.closest('form')).toBeTruthy()
  expect(alert.textContent).toContain('这个文件夹已经登记过了')
  expect((screen.getByLabelText('绝对路径') as HTMLInputElement).value).toBe('/tmp/other-fixture')
})

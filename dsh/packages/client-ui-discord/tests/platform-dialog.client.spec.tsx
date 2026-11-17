// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlatformDialog } from '../src/client/PlatformDialog.tsx'
import { zh } from '../src/client/locales.ts'
import type { ComponentProps } from 'react'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const t = ((key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), zh[key])) as ComponentProps<typeof PlatformDialog>['t']
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as Response
const fill = () => {
  fireEvent.change(screen.getByLabelText('名字'), { target: { value: '测试平台' } })
  fireEvent.change(screen.getByLabelText('绝对路径'), { target: { value: '/tmp/platform-fixture' } })
}
it('adds a generated code, shows name/path/public/file count and refreshes parent options', async () => {
  let rows: unknown[] = []
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'POST') { rows = [JSON.parse(String(init.body))]; return response({ platform: rows[0] }) }
    return response(String(url).endsWith('/files') ? { files: [{ isDir: false }, { isDir: true }], truncated: false } : { platforms: rows })
  })
  const onChange = vi.fn()
  render(<PlatformDialog t={t} onClose={vi.fn()} onChange={onChange} />)
  expect(await screen.findByText(zh.platformEmpty)).toBeTruthy()
  fill(); fireEvent.click(screen.getByRole('checkbox', { name: '公共' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })))
  expect(screen.getByText('测试平台 · /tmp/platform-fixture')).toBeTruthy()
  expect(screen.getByText('1 个文件')).toBeTruthy()
  expect(screen.getByText('公共', { selector: 'span' })).toBeTruthy()
  expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: expect.stringMatching(/^p-[a-z0-9]{28}$/), name: '测试平台', is_public: true })])
  expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/files$/), undefined)
})
it.each(['platform path does not exist', 'platform path must be a directory', 'platform p already exists'])('keeps validation %s beside the form', async error => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST' ? response({ error }, error.includes('exists') && !error.includes('not exist') ? 409 : 400) : response({ platforms: [] }))
  render(<PlatformDialog t={t} onClose={vi.fn()} onChange={vi.fn()} />)
  await screen.findByText(zh.platformEmpty)
  fill()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })))
  const alert = screen.getByRole('alert')
  expect(alert.closest('form')).toBeTruthy()
  expect(alert.textContent).toMatch(/路径不存在|路径不是文件夹|代号冲突/)
  expect((screen.getByLabelText('名字') as HTMLInputElement).value).toBe('测试平台')
})
it('edits existing entries and requires a separate delete confirmation', async () => {
  let rows = [{ id: 'a', name: '旧平台', path: '/tmp/platform-fixture', is_public: false }]
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'DELETE') { rows = []; return response({}) }
    if (init?.method === 'PATCH') { rows = [JSON.parse(String(init.body))]; return response({}) }
    return response(String(url).endsWith('/files') ? { files: [], truncated: false } : { platforms: rows })
  })
  render(<PlatformDialog t={t} onClose={vi.fn()} onChange={vi.fn()} />)
  await screen.findByText('旧平台 · /tmp/platform-fixture')
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByLabelText('名字'), { target: { value: '新平台' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })))
  expect(screen.getByText('新平台 · /tmp/platform-fixture')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  expect(screen.getByText(/任务上的平台会被清空/)).toBeTruthy()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' })))
  expect(screen.getByText(zh.platformEmpty)).toBeTruthy()
})

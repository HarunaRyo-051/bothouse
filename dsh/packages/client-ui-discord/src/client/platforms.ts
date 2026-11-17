export interface PlatformOption {
  readonly id: string
  readonly name: string
}

export interface PlatformRecord extends PlatformOption {
  readonly path: string
  readonly is_public: boolean | number
}

/** Preserve server validation details at the form that submitted them. */
export async function platformRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json()
  if (!response.ok) {
    const detail = String(body.error ?? response.status)
    const known: Record<string, string> = {
      'platform path does not exist': '路径不存在',
      'platform path must be a directory': '路径不是文件夹',
      'platform name and absolute path are required': '请填写名字和绝对路径',
    }
    throw new Error(known[detail] ?? (response.status === 409 ? `代号冲突：${detail}` : detail))
  }
  return body as T
}

export async function loadPlatforms(fetcher: typeof fetch = fetch): Promise<readonly PlatformOption[]> {
  const response = await fetcher('/collab/api/platforms')
  if (!response.ok) throw new Error(`平台列表读取失败：${response.status}`)
  const body = await response.json() as { platforms?: readonly PlatformOption[] }
  return body.platforms ?? []
}

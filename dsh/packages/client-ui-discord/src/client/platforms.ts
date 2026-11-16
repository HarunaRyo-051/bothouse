export interface PlatformOption {
  readonly id: string
  readonly name: string
}

export async function loadPlatforms(fetcher: typeof fetch = fetch): Promise<readonly PlatformOption[]> {
  const response = await fetcher('/collab/api/platforms')
  if (!response.ok) throw new Error(`平台列表读取失败：${response.status}`)
  const body = await response.json() as { platforms?: readonly PlatformOption[] }
  return body.platforms ?? []
}

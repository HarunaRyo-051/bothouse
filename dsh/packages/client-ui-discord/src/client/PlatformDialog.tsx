import { useEffect, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import { platformRequest, type PlatformRecord } from './platforms.ts'
import css from './ChannelsPage.module.css'
import { randomUUID } from './uuid.ts'

type Props = { t: TranslateNS<typeof NS>; onClose: () => void; onChange: (rows: readonly PlatformRecord[]) => void }
type SourceResult = {
  name: string; source: string; status: 'read' | 'partial' | 'unreadable'; version?: string
  note?: string; error?: string; note_error?: string; warnings?: string[]
  web?: { url: string; saved_at: string }; segments?: { quote: string; location: string }[]
}
type Organization = { results: SourceResult[] } | { error: string }
type FileCount = { count: number; truncated: boolean } | { error: string }

export function PlatformDialog({ t, onClose, onChange }: Props) {
  const [rows, setRows] = useState<readonly PlatformRecord[]>([])
  const [counts, setCounts] = useState<Record<string, FileCount>>({})
  const [organized, setOrganized] = useState<Record<string, Organization>>({})
  const [organizing, setOrganizing] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState({ id: '', name: '', path: '', is_public: false })
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<PlatformRecord>()
  const dialog = useRef<HTMLElement>(null)
  const change = useRef(onChange)
  change.current = onChange
  const refresh = async (): Promise<void> => {
    const body = await platformRequest<{ platforms: PlatformRecord[] }>('/collab/api/platforms')
    setRows(body.platforms)
    change.current(body.platforms)
    setCounts({})
    await Promise.all(body.platforms.map(async row => {
      try {
        const body = await platformRequest<{ files: { isDir: boolean }[]; truncated: boolean }>(`/collab/api/platforms/${encodeURIComponent(row.id)}/files`)
        setCounts(previous => ({ ...previous, [row.id]: { count: body.files.filter(file => !file.isDir).length, truncated: body.truncated } }))
      } catch (error) {
        setCounts(previous => ({ ...previous, [row.id]: { error: error instanceof Error ? error.message : String(error) } }))
      }
    }))
  }
  useEffect(() => {
    dialog.current?.focus()
    void refresh().catch(error => { setError(error instanceof Error ? error.message : String(error)) }).finally(() => { setLoading(false) })
  }, [])
  const reset = (): void => { setDraft({ id: '', name: '', path: '', is_public: false }); setError('') }
  const save = async (): Promise<void> => {
    setBusy(true); setError('')
    try {
      const id = draft.id || `p-${randomUUID().replaceAll('-', '').slice(0, 28)}`
      await platformRequest(`/collab/api/platforms${draft.id ? `/${encodeURIComponent(id)}` : ''}`, {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, id }),
      })
      setOrganized({})
      reset()
      await refresh()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const organize = async (id: string): Promise<void> => {
    setOrganizing(id)
    try {
      const result = await platformRequest<Organization>(`/collab/api/platforms/${encodeURIComponent(id)}/organize`, { method: 'POST' })
      setOrganized(previous => ({ ...previous, [id]: result }))
    } catch (error) {
      setOrganized(previous => ({ ...previous, [id]: { error: error instanceof Error ? error.message : String(error) } }))
    } finally { setOrganizing(undefined) }
  }
  const close = (): void => { if (!busy) onClose() }
  return <div className={css.dialogBackdrop} onClick={close}>
    <section className={`${css.dialog} ${css.settingsDialog}`} ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('platformLibrary')} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href]'))
      const first = controls[0], last = controls.at(-1)
      if (!controls.includes(document.activeElement as HTMLElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus()
      }
    }}>
      <h2 className={css.dialogTitle}>{t('platformLibrary')}</h2>
      <div className={css.settingsBody}>
        {loading ? <p role="status">{t('platformLoading')}</p> : rows.length === 0 ? <p>{t('platformEmpty')}</p> : rows.map(row => {
          const count = counts[row.id]
          const result = organized[row.id]
          return <div key={row.id} className={css.settingsFields}>
          <div style={{ overflowWrap: 'anywhere' }}>{row.name} · {row.path} {Boolean(row.is_public) && <span className={css.tag}>{t('platformPublic')}</span>}</div>
          <div>{count === undefined ? t('platformLoading') : 'error' in count ? <span role="alert">{count.error}</span> : <span>{t('platformFiles', { count: count.count })}{count.truncated ? '+' : ''}</span>}</div>
          <div className={css.dialogActions}>
            <button className={css.secondaryButton} type="button" disabled={busy || organizing !== undefined} onClick={() => { void organize(row.id) }}>{t(organizing === row.id ? 'platformOrganizing' : 'platformOrganize')}</button>
            <button className={css.secondaryButton} type="button" disabled={busy || organizing !== undefined} onClick={() => { setDraft({ ...row, is_public: Boolean(row.is_public) }); setDeleting(undefined); setError('') }}>{t('platformEdit')}</button>
            <button className={css.secondaryButton} type="button" disabled={busy || organizing !== undefined} onClick={() => { setDeleting(row); setError('') }}>{t('platformDelete')}</button>
          </div>
          {organizing === row.id && <p role="status">{t('platformOrganizing')}</p>}
          {result && ('error' in result ? <p role="alert">{result.error}</p> : result.results.length === 0 ? <p>{t('platformNoSources')}</p> : <ul aria-label={t('platformOrganize')}>
            {result.results.map(file => <li key={file.name} style={{ overflowWrap: 'anywhere' }}>
              <strong>{file.name}</strong> · {t(file.status === 'read' ? 'platformSourceRead' : file.status === 'partial' ? 'platformSourcePartial' : 'platformSourceUnreadable')}
              {file.error && <div>{file.error}</div>}
              {file.note_error && <div>{file.note_error}</div>}
              {file.warnings?.map((warning, i) => <div key={i}>{warning}</div>)}
              {file.note && <div>{t('platformNote', { path: file.note })}</div>}
              {file.segments && <details>
                <summary>{t('platformSourceDetails')}</summary>
                <div>{file.source}</div>
                <div>SHA-256: {file.version}</div>
                {file.web && <div>{t('platformSourceUrl')}: <a href={file.web.url} target="_blank" rel="noreferrer">{file.web.url}</a> · {t('platformSavedAt')}: {file.web.saved_at}</div>}
                {file.segments.map((segment, i) => <blockquote key={i} style={{ whiteSpace: 'pre-wrap' }}>{segment.location}
{segment.quote}</blockquote>)}
              </details>}
            </li>)}
          </ul>)}
        </div>})}
        {deleting && <section role="alertdialog" aria-label={t('platformDelete')}>
          <p>{t('platformDeleteConfirm', { name: deleting.name })}</p>
          <div className={css.dialogActions}>
            <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => setDeleting(undefined)}>{t('cancel')}</button>
            <button type="button" className={css.primaryButton} disabled={busy} onClick={() => {
              setBusy(true); setError('')
              void platformRequest(`/collab/api/platforms/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' }).then(async () => {
                if (draft.id === deleting.id) reset()
                setDeleting(undefined); setOrganized({}); await refresh()
              }).catch(error => { setError(error instanceof Error ? error.message : String(error)) }).finally(() => setBusy(false))
            }}>{t('platformDelete')}</button>
          </div>
        </section>}
        <form className={css.settingsFields} onSubmit={event => { event.preventDefault(); void save() }}>
          <h3>{t(draft.id ? 'platformEdit' : 'platformAdd')}</h3>
          <label className={css.field}>{t('platformName')}<input required className={css.fieldInput} disabled={busy} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }) }} /></label>
          <label className={css.field}>{t('platformPath')}<input required className={css.fieldInput} disabled={busy} value={draft.path} onChange={event => { setDraft({ ...draft, path: event.target.value }) }} /></label>
          <label className={css.choice}><input type="checkbox" disabled={busy} checked={draft.is_public} onChange={event => { setDraft({ ...draft, is_public: event.target.checked }) }} />{t('platformPublic')}</label>
          {error && <div className={css.sendError} role="alert">{error}</div>}
          <div className={css.dialogActions}>
            {draft.id && <button type="button" className={css.secondaryButton} disabled={busy} onClick={reset}>{t('cancel')}</button>}
            <button type="submit" className={css.primaryButton} disabled={busy || organizing !== undefined || loading || !draft.name.trim() || !draft.path.trim()}>{t(busy ? 'settingsSaving' : 'messageSave')}</button>
          </div>
        </form>
      </div>
      <div className={css.dialogActions}><button type="button" className={css.secondaryButton} disabled={busy} onClick={close}>{t('close')}</button></div>
    </section>
  </div>
}

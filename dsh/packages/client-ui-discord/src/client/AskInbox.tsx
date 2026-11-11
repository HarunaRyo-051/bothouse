import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelAsk, ChannelActions, ChannelPendingItem } from './channel-source.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

type T = TranslateNS<typeof NS>

function Preview({ text, t }: { text: string; t: T }) {
  const [expanded, setExpanded] = useState(false)
  return <>
    <div className={css.inboxText} style={expanded ? undefined : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</div>
    {text.split('\n').length > 3 && <button type="button" className={css.linkButton} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'askCollapse' : 'askExpand')}</button>}
  </>
}

function AskRow({ ask, answer, t }: { ask: ChannelAsk; answer: ChannelActions['answerAsk']; t: T }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className={css.inboxRow}>
    <div className={css.inboxMeta}>{ask.task_id === null ? '' : `#${ask.task_id} · `}{ask.task_title || ask.workspace_name} · {ask.member_name} · {t('askWaiting', { minutes: ask.minutes_waiting })}</div>
    <Preview text={ask.text} t={t} />
    <form className={css.inboxForm} onSubmit={event => {
      event.preventDefault()
      if (busy || !text.trim()) return
      setBusy(true)
      setError('')
      void answer(ask.id, text).catch(reason => setError(String(reason))).finally(() => setBusy(false))
    }}>
      <textarea aria-label={t('askReply')} value={text} disabled={busy} onChange={event => setText(event.target.value)} />
      <button className={css.primaryButton} type="submit" disabled={busy || !text.trim()}>{t('askSend')}</button>
    </form>
    {error && <div role="alert">{error}</div>}
  </div>
}

function PendingRow({ item, decide, retry, t }: { item: ChannelPendingItem; decide: ChannelActions['decidePermission']; retry: ChannelActions['retryMessage']; t: T }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const perform = (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    void action().catch(reason => setError(String(reason))).finally(() => setBusy(false))
  }
  return <div className={css.inboxRow}>
    <div className={css.inboxMeta}>{item.task_id === null ? '' : `#${item.task_id} · `}{item.task_title || item.workspace_name} · {item.member_name} · {t('askWaiting', { minutes: item.minutes_waiting })}</div>
    <Preview text={item.text} t={t} />
    <div className={css.inboxActions}>
      {item.kind === 'approval' ? <>
        <button type="button" className={css.primaryButton} disabled={busy} onClick={() => perform(() => decide(item.request_id!, 'allow'))}>{t('inboxAllow')}</button>
        <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => perform(() => decide(item.request_id!, 'deny'))}>{t('inboxDeny')}</button>
      </> : <button type="button" className={css.secondaryButton} disabled={busy} onClick={() => perform(() => retry(item.message_id))}>{busy ? t('retrying') : t('retry')}</button>}
    </div>
    {error && <div role="alert">{error}</div>}
  </div>
}

export function AskInbox({ asks, answer, items = [], decide, retry, t }: { asks: readonly ChannelAsk[]; answer: ChannelActions['answerAsk']; items?: readonly ChannelPendingItem[]; decide: ChannelActions['decidePermission']; retry: ChannelActions['retryMessage']; t: T }) {
  const [expanded, setExpanded] = useState(false)
  if (!asks.length && !items.length) return null
  const approvals = items.filter(item => item.kind === 'approval')
  const failures = items.filter(item => item.kind === 'failed')
  return <section className={css.inbox} data-testid="ask-inbox">
    <button type="button" className={css.inboxToggle} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span>{t('pendingCount', { count: asks.length + items.length })} · {t('pendingAsks', { count: asks.length })} · {t('pendingApprovals', { count: approvals.length })}{failures.length ? ` · ${t('pendingFailures', { count: failures.length })}` : ''}</span>
      <span aria-hidden>{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className={css.inboxList}>
      {asks.map(ask => <AskRow key={ask.id} ask={ask} answer={answer} t={t} />)}
      {items.map(item => <PendingRow key={`${item.kind}:${item.message_id}`} item={item} decide={decide} retry={retry} t={t} />)}
    </div>}
  </section>
}

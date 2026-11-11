import { useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChannelAsk, ChannelActions, ChannelPendingItem } from './channel-source.ts'
import type { NS } from './locales.ts'
import css from './ChannelsPage.module.css'

type T = TranslateNS<typeof NS>
function AskRow({ ask, answer, t }: { ask: ChannelAsk; answer: ChannelActions['answerAsk']; t: T }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div>
    <div className={css.cardButtons}>
      <span title={ask.task_title}>{ask.task_id === null ? '' : `#${ask.task_id} · `}{ask.workspace_name} · {ask.member_name} · {t('askWaiting', { minutes: ask.minutes_waiting })}</span>
      <button type="button" className={css.primaryButton} onClick={() => setEditing(!editing)}>{t('askReply')}</button>
    </div>
    <div className={css.text} style={expanded ? { whiteSpace: 'pre-wrap' } : { whiteSpace: 'pre-wrap', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ask.text}</div>
    {(ask.text.length > 120 || ask.text.split('\n').length > 3) && <button type="button" className={css.secondaryButton} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{t(expanded ? 'askCollapse' : 'askExpand')}</button>}
    {editing && <form className={css.taskFileForm} onSubmit={event => {
      event.preventDefault()
      if (busy || !text.trim()) return
      setBusy(true)
      setError('')
      void answer(ask.id, text).catch(reason => setError(String(reason))).finally(() => setBusy(false))
    }}>
      <textarea aria-label={t('askReply')} value={text} disabled={busy} onChange={event => setText(event.target.value)} autoFocus />
      <button className={css.secondaryButton} type="submit" disabled={busy || !text.trim()}>{t('askSend')}</button>
      {error && <div role="alert">{error}</div>}
    </form>}
  </div>
}

export function AskInbox({ asks, answer, items = [], onOpen, t }: { asks: readonly ChannelAsk[]; answer: ChannelActions['answerAsk']; items?: readonly ChannelPendingItem[]; onOpen?: (room: number, message: number) => void; t: T }) {
  if (!asks.length && !items.length) return null
  const approvals = items.filter(item => item.kind === 'approval')
  const failures = items.filter(item => item.kind === 'failed')
  return <div className={css.card} data-testid="ask-inbox">
    <div className={css.cardTitle}>{[asks.length ? t('askCount', { count: asks.length }) : '', approvals.length ? t('approvalCount', { count: approvals.length }) : '', failures.length ? t('failureCount', { count: failures.length }) : ''].filter(Boolean).join(' · ')}</div>
    {asks.length > 0 && <details open><summary>{t('askSection')}</summary>{asks.map(ask => <AskRow key={ask.id} ask={ask} answer={answer} t={t} />)}</details>}
    {[approvals, failures].map((group, index) => group.length > 0 && <details key={index}>
      <summary>{t(index === 0 ? 'approvalCount' : 'failureCount', { count: group.length })}</summary>
      {group.map(item => <div key={item.message_id}>
        <button type="button" className={css.secondaryButton} onClick={() => onOpen?.(item.room_id, item.message_id)}>{item.workspace_name} · {item.member_name} · {t('askWaiting', { minutes: item.minutes_waiting })}</button>
        <div className={css.text}>{item.text}</div>
      </div>)}
    </details>)}
  </div>
}

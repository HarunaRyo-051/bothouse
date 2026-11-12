import { BOARD_TABS } from './task-board.ts'
import type { ChannelTask } from './channel-source.ts'
import type { T } from './locales.ts'
import css from './ChannelsPage.module.css'

/**
 * One line at the top of the channel log: how much work this channel has, grouped the same way
 * the board groups it. A click opens the board; it draws nothing when there is no task at all.
 */
export function ProgressCard({ tasks, chatId, t, onOpen }: {
  tasks: readonly ChannelTask[]
  /** The chat channel the tasks belong to; tasks already filtered by the caller. */
  chatId: number | undefined
  t: T
  onOpen: () => void
}) {
  const mine = tasks.filter(task => chatId === undefined || task.room_id === chatId || task.parent_task !== null)
  if (mine.length === 0) return null
  const count = (id: string) => {
    const tab = BOARD_TABS.find(candidate => candidate.id === id)
    return tab === undefined ? 0 : mine.filter(task => tab.statuses.length === 0 || tab.statuses.includes(task.status)).length
  }
  const working = count('working')
  const review = count('review')
  const done = count('done')
  return (
    <button type="button" className={css.progressCard} onClick={onOpen} data-working={working > 0}>
      <span className={css.progressTitle}>{t('channelProgress')}</span>
      <span>{t('channelProgressWorking', { n: String(working) })}</span>
      {review > 0 && <span>{t('channelProgressReview', { n: String(review) })}</span>}
      <span className={css.progressDone}>{t('channelProgressDone', { n: String(done) })}</span>
    </button>
  )
}

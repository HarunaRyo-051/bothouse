/** A main panel that is just our own page in a frame: the wiki galaxy needs no React rewrite. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ChannelsPage.module.css'

export function EmbedPage({ path, title }: { readonly path: string; readonly title: string }) {
  return (
    <iframe
      className={css.embedFrame}
      src={path}
      title={title}
      referrerPolicy="no-referrer"
    />
  )
}

export type EmbedPageProps = PropsRuntime<'main'>

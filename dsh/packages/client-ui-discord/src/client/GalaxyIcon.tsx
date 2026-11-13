/** Decorative occupant for the wiki-galaxy sidebar entry. */
import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the globe glyph at the size the sidebar asks for; the sidebar owns the label.
 * @param props - the sidebar's icon share.
 * @returns decorative icon.
 */
export function GalaxyIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconGlobeOutlineRegular size={size} />
}

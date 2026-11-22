import { env } from 'orca'
import { translate, type Message } from './core/i18n.ts'
// Read the host locale at use time; never persist a separate language choice.
export const t = (message: Message): string => translate(env.locale, message)

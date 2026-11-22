import { en, type Message } from '../locales/en.ts'
import de from '../locales/de.ts'
import es from '../locales/es.ts'
import fr from '../locales/fr.ts'
import ja from '../locales/ja.ts'
import ko from '../locales/ko.ts'
import pt from '../locales/pt.ts'
import ru from '../locales/ru.ts'
import tr from '../locales/tr.ts'
import zh from '../locales/zh.ts'
import zhHant from '../locales/zh-Hant.ts'
export type { Message }
// Built-in UI locales observed in Orca 1.4.265. Unknown language packs use English.
export const locales = ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh', 'zh-Hant'] as const
export type Locale = typeof locales[number]
export const catalogs: Readonly<Record<Locale, Readonly<Record<Message, string>>>> = { en, de, es, fr, ja, ko, pt, ru, tr, zh, 'zh-Hant': zhHant }
export function resolveLocale(locale: string): Locale {
  const tag = typeof locale === 'string' ? locale.trim().replaceAll('_', '-').toLowerCase() : ''
  const parts = tag.split('-'), base = parts[0]
  if (base === 'zh') {
    if (parts.includes('hant')) return 'zh-Hant'
    if (parts.includes('hans')) return 'zh'
    return parts.some(p => ['tw', 'hk', 'mo'].includes(p)) ? 'zh-Hant' : 'zh'
  }
  return locales.includes(base as Locale) ? base as Locale : 'en'
}
export function translate(locale: string, message: Message): string {
  const dictionary = catalogs[resolveLocale(locale)]
  return Object.hasOwn(dictionary, message) ? dictionary[message] : message
}

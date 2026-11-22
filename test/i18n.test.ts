import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogs, locales, resolveLocale, translate, type Message } from '../src/core/i18n.ts'
test('every built-in Orca locale has a complete nonempty catalog with unchanged numeric limits', () => {
  assert.deepEqual(locales, ['en', 'de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh', 'zh-Hant'])
  const keys = Object.keys(catalogs.en).sort() as Message[]
  assert.equal(keys.length, 223)
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale)
    for (const key of keys) {
      const value = translate(locale, key)
      assert.ok(value.trim().length > 0, `${locale}: ${key}`)
      assert.deepEqual(value.match(/\d+/g)?.sort(), key.match(/\d+/g)?.sort(), `${locale}: numeric limits in ${key}`)
    }
    if (locale !== 'en') assert.notEqual(translate(locale, 'Save settings'), catalogs.en['Save settings'])
  }
})
test('locale matching respects language, explicit Chinese script, region and English fallback', () => {
  for (const [input, expected] of Object.entries({
    'en-US': 'en', 'ru-RU': 'ru', 'de-DE': 'de', 'es-MX': 'es', 'fr-CA': 'fr', 'pt_BR': 'pt',
    'ja-JP': 'ja', 'ko-KR': 'ko', 'tr-TR': 'tr', 'zh-CN': 'zh', 'zh-SG': 'zh', 'zh-TW': 'zh-Hant',
    'zh-HK': 'zh-Hant', 'zh-MO': 'zh-Hant', 'ZH_hant_TW': 'zh-Hant', 'zh-Hans-TW': 'zh',
    'zh-Hant-CN': 'zh-Hant', 'it-IT': 'en', '': 'en', '__proto__': 'en', constructor: 'en'
  })) assert.equal(resolveLocale(input), expected, input)
  assert.equal(translate('unknown', 'Save settings'), 'Save settings')
  assert.equal(resolveLocale('__proto__'), 'en')
})

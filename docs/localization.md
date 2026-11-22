# Localization

Fairway reads `env.locale` from Orca at translation/render time. It does not read the OS language, inspect Orca preferences files, persist a language override, or use network translation. The host controls the frame environment. Tests mount panels with each host locale; changing the real application's global language during a session was not separately tested.

## Supported built-in locales

The installed Orca 1.4.265 package contains built-in locale resources for `en`, `de`, `es`, `fr`, `ja`, `ko`, `pt`, `ru`, `tr`, `zh`, and `zh-Hant`. Discovery used shipped locale resource filenames and the version-matched components API, without reading user configuration or other work repositories. These are the bundled languages, not an exhaustive list of possible community language packs.

All 11 catalogs contain the same 160 messages. English source phrases are typed message keys; every translated catalog must satisfy `Record<Message, string>`. Missing or extra keys fail type checking. Tests also check nonempty translations and preserve numeric policy limits across languages. The initial translations have not received independent native-speaker review.

`resolveLocale` accepts case-insensitive language tags and regional variants, including underscore separators. Explicit Chinese script wins over region: `zh-Hans-TW` uses Simplified Chinese, `zh-Hant-CN` uses Traditional Chinese. Without a script, Taiwan, Hong Kong, and Macao select Traditional Chinese. Unsupported language packs use English.

`src/ui-i18n.ts` reads the current host locale. `src/core/i18n.ts` handles language matching and lookup without importing Orca, so standalone tests and CI can validate it. Catalogs are bundled statically under `src/locales/`; no external library, API, or runtime download is required.

Visual samples: [Russian](../assets/settings-ru-dark.png), [German](../assets/settings-de-dark.png), and [Traditional Chinese](../assets/settings-zh-Hant-dark.png).

## What is translated

Panel tabs, fields, buttons, helper text, human-readable validation errors, workflow controls, and audit headings follow the host locale. Error state stores the message key rather than a translated sentence, so rendering can use the current locale.

User-authored tasks, analysis, reviews, profile IDs/descriptions, model aliases, effort identifiers, source references, audit data, and diagnostic codes stay unchanged. Changing language does not alter configuration hashes, invalidate decisions, enable network access, or dispatch an agent.

## Host API limitations

In this Orca version, manifest titles/descriptions for native settings and palette commands are plain strings, with no documented locale map or dynamic label API. Worker commands also have no documented UI-locale field. Those strings remain English; the panel's Settings form is fully localized. Fairway does not rewrite the installed manifest or register an application language pack to work around this limitation.

Orca check scenarios do not expose a locale option in this version. All-locale coverage therefore uses `mount(..., { locale })` in panel tests; the nine standard check scenarios remain separate. UI previews may seed a locale in a temporary staged copy for visual review without changing the user's global app settings.

## Adding or updating a locale

1. Add a typed catalog using the English message keys from `src/locales/en.ts`.
2. Register it in `src/core/i18n.ts` and update locale matching if needed.
3. Run `npm run typecheck`, `npm run typecheck:core`, `npm test`, and `npm run test:orca`.
4. Inspect layouts in Orca, especially long labels and CJK text, and update the verified locale list in these docs.

Keep machine identifiers, technical paths, numeric limits, and secrets out of translation changes. Public prose documentation is currently maintained in English.

#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '@vidbee/logger/script'
import { untranslatedDebt } from './untranslated-debt.js'

const currentFilePath = fileURLToPath(import.meta.url)
const currentDirPath = path.dirname(currentFilePath)
const localesDir = path.join(currentDirPath, '..', '..', '..', 'packages', 'i18n', 'src', 'locales')
const baseLocaleFile = 'en.json'

const readJson = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    log.error(`ERROR: Failed to read ${filePath}`)
    log.error(String(error))
    process.exit(1)
  }
}

/**
 * Flatten a locale object to its leaf values.
 * Empty strings stay in the map so callers can reject them instead of
 * treating a present-but-blank key as translated.
 * @param {unknown} value Locale node.
 * @param {string} prefix Key path built so far.
 * @param {Map<string, unknown>} leaves Collected leaf values.
 * @returns {Map<string, unknown>}
 */
const collectLeafValues = (value, prefix = '', leaves = new Map()) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        collectLeafValues(child, next, leaves)
      } else {
        leaves.set(next, child)
      }
    }
    return leaves
  }

  if (prefix) {
    leaves.set(prefix, value)
  }

  return leaves
}

/**
 * A copied English sentence is not a translation. Short labels, brand names,
 * URLs, and format examples are allowed to match English.
 * @param {unknown} value Leaf value.
 * @returns {boolean}
 */
const isTranslatableCopy = (value) => {
  if (typeof value !== 'string') {
    return false
  }
  const text = value.trim()
  if (text.length <= 12) {
    return false
  }
  if (/^https?:\/\//.test(text)) {
    return false
  }
  if (!/[A-Za-z]{3,}/.test(text)) {
    return false
  }
  return true
}

if (!fs.existsSync(localesDir)) {
  log.error(`ERROR: Locales directory not found: ${localesDir}`)
  process.exit(1)
}

const localeFiles = fs
  .readdirSync(localesDir)
  .filter((file) => file.endsWith('.json'))
  .sort()

if (!localeFiles.includes(baseLocaleFile)) {
  log.error(`ERROR: Base locale file not found: ${baseLocaleFile}`)
  process.exit(1)
}

const baseLocalePath = path.join(localesDir, baseLocaleFile)
const baseLocaleData = readJson(baseLocalePath)
const baseValues = collectLeafValues(baseLocaleData)

let hasMissing = false
let hasUntranslated = false
let hasExtra = false

for (const file of localeFiles) {
  if (file === baseLocaleFile) {
    continue
  }

  const localePath = path.join(localesDir, file)
  const localeData = readJson(localePath)
  const localeValues = collectLeafValues(localeData)

  const missing = [...baseValues.keys()].filter((key) => !localeValues.has(key))
  const empty = [...baseValues.keys()].filter((key) => {
    const value = localeValues.get(key)
    return localeValues.has(key) && (typeof value !== 'string' || value.trim() === '')
  })
  const knownDebt = new Set(untranslatedDebt[file] ?? [])
  const untranslated = [...baseValues.keys()].filter((key) => {
    const source = baseValues.get(key)
    return localeValues.get(key) === source && isTranslatableCopy(source) && !knownDebt.has(key)
  })
  const staleDebt = [...knownDebt].filter((key) => localeValues.get(key) !== baseValues.get(key))
  const extra = [...localeValues.keys()].filter((key) => !baseValues.has(key))

  if (missing.length > 0 || empty.length > 0) {
    hasMissing = true
    log.error(`ERROR: Missing keys in ${file}`)
    for (const key of [...missing, ...empty]) {
      log.error(`  - ${key}`)
    }
  }

  if (untranslated.length > 0) {
    hasUntranslated = true
    log.error(`ERROR: Untranslated English copy in ${file}`)
    for (const key of untranslated) {
      log.error(`  - ${key}`)
    }
  }

  if (staleDebt.length > 0) {
    hasUntranslated = true
    log.error(`ERROR: ${file} translates keys still listed in untranslated-debt.js`)
    for (const key of staleDebt) {
      log.error(`  - ${key}`)
    }
  }

  if (extra.length > 0) {
    hasExtra = true
    log.warn(`WARN: Extra keys in ${file}`)
    for (const key of extra) {
      log.warn(`  - ${key}`)
    }
  }
}

if (hasMissing || hasUntranslated) {
  process.exit(1)
}

if (hasExtra) {
  log.log('INFO: No missing keys, but extra keys were found.')
  process.exit(0)
}

log.log('OK: All locale files include every key from en.json.')

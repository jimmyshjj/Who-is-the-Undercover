import type { ThemeKey, WordPair, Wordbank } from './types'

export const getThemeOptions = () => [
  { value: 'politics', label: '政治' },
  { value: 'history', label: '历史' },
  { value: 'games', label: '游戏' },
  { value: 'movies', label: '电影' },
  { value: 'anime', label: '二次元' },
  { value: 'custom', label: '自定义' }
]

export const toThemeLabel = (theme: ThemeKey): string => ({
  politics: '政治',
  history: '历史',
  games: '游戏',
  movies: '电影',
  anime: '二次元',
  custom: '自定义'
}[theme])

export const getWordPairsForWordbank = (wordbank?: Wordbank): WordPair[] => {
  return wordbank?.pairs || []
}

export const normalizeWordbank = (raw: unknown): Wordbank => {
  if (!raw || typeof raw !== 'object') throw new Error('词库 JSON 不是对象')
  const input = raw as { id?: string, name?: string, pairs?: unknown[], themes?: Record<string, unknown> }
  if (!input.name) throw new Error('词库缺少 name')

  const pairs: WordPair[] = []

  // 支持新格式 pairs 数组
  if (Array.isArray(input.pairs)) {
    for (const row of input.pairs) {
      if (Array.isArray(row) && row.length >= 3) {
        pairs.push({
          goodWord: String(row[0]),
          undercoverWord: String(row[1]),
          domainHint: String(row[2])
        })
      } else if (row && typeof row === 'object') {
        const item = row as Partial<WordPair>
        if (item.goodWord && item.undercoverWord && item.domainHint) {
          pairs.push({
            goodWord: String(item.goodWord),
            undercoverWord: String(item.undercoverWord),
            domainHint: String(item.domainHint)
          })
        }
      }
    }
  }

  // 兼容旧格式 themes 对象（将所有主题的词对合并）
  if (input.themes && typeof input.themes === 'object') {
    for (const rows of Object.values(input.themes)) {
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (Array.isArray(row) && row.length >= 3) {
          pairs.push({
            goodWord: String(row[0]),
            undercoverWord: String(row[1]),
            domainHint: String(row[2])
          })
        } else if (row && typeof row === 'object') {
          const item = row as Partial<WordPair & { common?: boolean }>
          if (item.goodWord && item.undercoverWord && item.domainHint) {
            pairs.push({
              goodWord: String(item.goodWord),
              undercoverWord: String(item.undercoverWord),
              domainHint: String(item.domainHint)
            })
          }
        }
      }
    }
  }

  if (pairs.length === 0) throw new Error('词库中没有有效的词对')

  return {
    id: input.id || `custom-${Date.now()}`,
    name: input.name,
    pairs
  }
}

import type {
  AppSettings,
  FlavorResult,
  GamePhase,
  GuessJudgeResult,
  Player,
  PlayerAction,
  SetupResult,
  WordPair
} from './types'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const renderTemplate = (template: string, variables: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '')

const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, '')

const buildEndpoint = (baseUrl: string) => `${normalizeBaseUrl(baseUrl)}/chat/completions`

const parseFirstJson = <T>(raw: string): T => {
  const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('JSON parse failed')
    return JSON.parse(match[0]) as T
  }
}

const timeoutFetch = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

export const callOpenAiCompatible = async <T>(
  settings: AppSettings,
  model: string,
  messages: ChatMessage[]
): Promise<{ data: T, raw: string }> => {
  let lastError = 'UnknownError'
  let lastRaw = ''
  for (let attempt = 0; attempt <= settings.retryCount; attempt++) {
    try {
      const response = await timeoutFetch(buildEndpoint(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: settings.temperature
        })
      }, settings.timeoutMs)

      if (!response.ok) {
        lastRaw = await response.text()
        lastError = `HTTP_${response.status}`
        continue
      }

      const payload = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = payload.choices?.[0]?.message?.content || ''
      lastRaw = content
      const data = parseFirstJson<T>(content)
      return { data, raw: content }
    } catch (error) {
      lastError = error instanceof DOMException && error.name === 'AbortError'
        ? 'Timeout'
        : error instanceof Error
          ? error.message
          : 'UnknownError'
    }
  }
  throw new Error(`${lastError}::${lastRaw}`)
}

export const setupWordsWithHost = async (
  settings: AppSettings,
  themeLabel: string,
  excludeCommonWords: boolean,
  candidates?: WordPair[]
): Promise<SetupResult> => {
  const candidateSection = candidates && candidates.length > 0
    ? `你必须只从下面候选词对中选择，不要自创：\n${candidates.map((pair, index) =>
      `${index + 1}. ${pair.goodWord} | ${pair.undercoverWord} | ${pair.domainHint}`
    ).join('\n')}`
    : ''

  const avoidCommonSection = excludeCommonWords
    ? '\n注意：请避免使用过于常见、过于大众化的词汇，选择相对冷门但玩家仍能理解的词对。'
    : ''

  const userContent = renderTemplate(settings.promptTemplates.hostSetupUser, {
    themeLabel,
    candidateSection,
    candidateSample: candidateSection
  }) + avoidCommonSection

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: settings.promptTemplates.hostSetupSystem
    },
    {
      role: 'user',
      content: userContent
    }
  ]
  return (await callOpenAiCompatible<SetupResult>(settings, settings.hostModel, messages)).data
}

export const judgeGuessWithHost = async (
  settings: AppSettings,
  correctPair: { goodWord: string, undercoverWord: string },
  guess: { word_a: string, word_b: string }
): Promise<GuessJudgeResult> => {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: settings.promptTemplates.hostJudgeSystem
    },
    {
      role: 'user',
      content: renderTemplate(settings.promptTemplates.hostJudgeUser, {
        goodWord: correctPair.goodWord,
        undercoverWord: correctPair.undercoverWord,
        guessA: guess.word_a,
        guessB: guess.word_b
      })
    }
  ]
  return (await callOpenAiCompatible<GuessJudgeResult>(settings, settings.hostModel, messages)).data
}

export const createFlavorLine = async (
  settings: AppSettings,
  phase: GamePhase,
  facts: string
): Promise<string> => {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: settings.promptTemplates.hostFlavorSystem
    },
    {
      role: 'user',
      content: renderTemplate(settings.promptTemplates.hostFlavorUser, {
        phase,
        facts
      })
    }
  ]
  try {
    const result = await callOpenAiCompatible<FlavorResult>(settings, settings.hostModel, messages)
    return result.data.line
  } catch {
    return facts
  }
}

export const requestPlayerAction = async (
  settings: AppSettings,
  player: Player,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ action: PlayerAction, raw: string }> => {
  const result = await callOpenAiCompatible<PlayerAction>(settings, model, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ])
  return {
    action: result.data,
    raw: result.raw
  }
}

export const testModelConnection = async (
  settings: AppSettings,
  model: string
): Promise<string> => {
  const result = await callOpenAiCompatible<{ ok: boolean, reply: string }>(settings, model, [
    {
      role: 'system',
      content: '你在执行模型连通性测试。只输出 JSON。'
    },
    {
      role: 'user',
      content: '{"ok":true,"reply":"pong"}'
    }
  ])
  return result.data.reply || 'ok'
}

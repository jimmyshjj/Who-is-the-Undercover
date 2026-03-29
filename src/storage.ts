import type { AppSettings, ExportBlob, GameConfig, GameState, PromptTemplates, Scoreboard, Wordbank } from './types'

export const STORAGE_KEYS = {
  settings: 'app_settings',
  config: 'game_config',
  currentGame: 'current_game',
  history: 'game_history',
  scoreboard: 'scoreboard',
  customWordbanks: 'custom_wordbanks'
} as const

export const defaultPromptTemplates: PromptTemplates = {
  hostSetupSystem: '你是主持人，负责从候选词对里挑一个适合“谁是卧底”的词对。只输出 JSON，不要代码块。',
  hostSetupUser:
    '主题：{{themeLabel}}\n' +
    '请从候选词对中选择一组最适合本局的词，并输出 JSON：{"good_word":"...","undercover_word":"...","domain_hint":"...","opening_line":"..."}\n' +
    '要求：领域提示要覆盖两个词但不直接泄题；opening_line 保持 1 句、黑红白漫画感。\n' +
    '候选词对：\n{{candidateSection}}',
  hostJudgeSystem: '你是裁判。只输出 JSON，不要解释，不要代码块。',
  hostJudgeUser:
    '判断玩家猜的两个词，是否与正确词对在语义上明显对应。顺序无关，不能因为只是同类大词就判 true。\n' +
    '正确词对：{{goodWord}} / {{undercoverWord}}\n' +
    '玩家猜测：{{guessA}} / {{guessB}}\n' +
    '输出 {"success":true/false,"reason":"一句极短原因"}',
  hostFlavorSystem: '你负责生成一句风格化主持人播报。风格是高对比、斜切、漫画式、带冲击力。只输出 JSON。',
  hostFlavorUser: '阶段：{{phase}}\n事实：{{facts}}\n输出 {"line":"不超过30字的一句播报"}',
  playerSystem:
    '你在扮演“AI 谁是卧底”中的一名玩家。' +
    '你只知道自己当前拿到的私密信息，不知道完整全局信息。请只根据私密信息、公开历史、玩家存活状态和当前阶段行动，不要编造额外规则或秘密。' +
    '身份与信息：如果你拿到的是一个明确词语，你可能是好人，也可能是卧底；如果你拿到的是两个打乱的词，你是预言家；如果你拿到的只是领域提示，你是白痴。' +
    '胜利条件：好人阵营要清除卧底和白痴；卧底阵营要清除好人和白痴；白痴要通过准确猜中双词单独获胜，或成为场上最后仅存阵营。' +
    '目标与策略：阵营胜利优先，不是单纯避免自己淘汰；即使你中途出局，只要本阵营最终获胜，你这一局仍算赢。好人的目标是找出并投出卧底与白痴；卧底的目标是隐藏自己、误导他人并帮助卧底阵营清场；预言家属于好人阵营，信息更多，必要时可以牺牲自己发言带票；白痴信息最少，应优先伪装自然，只在把握较高时猜词。' +
    '发言要求：发言尽量简单短句，不得超过20字；不要直接说出你的词；描述要模糊，但要有一点区分度。' +
    '行动要求：`description` / `day_talk` 填写 `public_line`；`discussion` 可设 `speak=false` 跳过，若发言则设 `speak=true` 并填写 `public_line`；`vote` 填写 `vote_target`，若需要理由再填写简短 `vote_reason`；`guess_words` 只有白痴可以填写，没有较高把握时保持 null；`night` 只有卧底可以设 `knife=true`，若刀人再填写 `knife_target`。' +
    '危险：白痴猜错会立即淘汰；如果你不是卧底却在夜晚设 `knife=true`，会立即自杀出局。' +
    '只返回纯 JSON 字符串，不要 Markdown，不要解释。{{turnRules}}',
  playerUser:
    '当前轮次：第 {{round}} 轮\n' +
    '当前阶段：{{kind}}\n' +
    '你的编号：{{playerId}}\n' +
    '{{secretText}}\n' +
    '你的历史 private_note：{{privateNotes}}\n' +
    '公开历史：\n{{publicHistory}}\n' +
    '玩家状态：\n{{visibleStatus}}\n' +
    '{{voteTargetsLine}}{{knifeTargetsLine}}' +
    '本回合输出 JSON 结构：{{jsonSchema}}\n' +
    '{{voteReasonRule}}{{guessRule}}' +
    '请只基于以上信息行动。'
}

export const defaultSettings: AppSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  rememberApiKey: false,
  hostModel: 'gpt-4o-mini',
  defaultPlayerModel: 'gpt-4o-mini',
  playerModels: {},
  temperature: 0.7,
  timeoutMs: 45000,
  retryCount: 1,
  promptTemplates: defaultPromptTemplates
}

export const readJson = <T>(key: string, fallback: T): T => {
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const writeJson = (key: string, value: unknown) => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

export const loadSettings = (): AppSettings => {
  const raw = readJson<AppSettings>(STORAGE_KEYS.settings, defaultSettings)
  const safeTemperature = typeof raw.temperature === 'number' && Number.isFinite(raw.temperature)
    ? Math.min(2, Math.max(0, raw.temperature))
    : defaultSettings.temperature
  return {
    ...defaultSettings,
    ...raw,
    temperature: safeTemperature,
    promptTemplates: {
      ...defaultPromptTemplates,
      ...(raw.promptTemplates || {})
    },
    apiKey: raw.rememberApiKey ? raw.apiKey || '' : ''
  }
}

export const saveSettings = (settings: AppSettings) => {
  const stored: AppSettings = {
    ...settings,
    temperature: Number.isFinite(settings.temperature) ? Math.min(2, Math.max(0, settings.temperature)) : defaultSettings.temperature,
    apiKey: settings.rememberApiKey ? settings.apiKey : ''
  }
  writeJson(STORAGE_KEYS.settings, stored)
}

export const defaultConfig: GameConfig = {
  theme: 'custom',
  customThemeLabel: '',
  excludeCommonWords: false,
  totalPlayers: 5,
  humanPlayers: 0,
  aiPlayers: 5,
  discussionRounds: 2,
  showVoteDetails: false,
  showVoteReasons: false,
  useCustomWordbank: false,
  customWordbankId: ''
}

export const loadConfig = (): GameConfig => {
  const raw = readJson<GameConfig>(STORAGE_KEYS.config, defaultConfig)
  return {
    ...defaultConfig,
    ...raw
  }
}

export const saveConfig = (config: GameConfig) => {
  writeJson(STORAGE_KEYS.config, config)
}

export const loadCurrentGame= (): GameState | null => readJson<GameState | null>(STORAGE_KEYS.currentGame, null)

export const saveCurrentGame = (game: GameState | null) => writeJson(STORAGE_KEYS.currentGame, game)

export const loadHistory = (): GameState[] => readJson<GameState[]>(STORAGE_KEYS.history, [])

export const saveHistory = (history: GameState[]) => writeJson(STORAGE_KEYS.history, history.slice(0, 50))

export const loadScoreboard = (): Scoreboard => readJson<Scoreboard>(STORAGE_KEYS.scoreboard, {})

export const saveScoreboard = (scoreboard: Scoreboard) => writeJson(STORAGE_KEYS.scoreboard, scoreboard)

export const loadCustomWordbanks = (): Record<string, Wordbank> =>
  readJson<Record<string, Wordbank>>(STORAGE_KEYS.customWordbanks, {})

export const saveCustomWordbanks = (banks: Record<string, Wordbank>) => writeJson(STORAGE_KEYS.customWordbanks, banks)

export const buildExportBlob = (
  settings: AppSettings,
  config: GameConfig,
  currentGame: GameState | null,
  history: GameState[],
  scoreboard: Scoreboard,
  customWordbanks: Record<string, Wordbank>
): ExportBlob => ({
  version: 1,
  settings: {
    ...settings,
    apiKey: settings.rememberApiKey ? settings.apiKey : ''
  },
  config,
  currentGame,
  history,
  scoreboard,
  customWordbanks
})

export const isExportBlob = (value: unknown): value is ExportBlob => {
  if (!value || typeof value !== 'object') return false
  const blob = value as ExportBlob
  return blob.version === 1 &&
    'settings' in blob &&
    // backward compatible: old exports did not contain config
    'history' in blob &&
    'scoreboard' in blob &&
    'customWordbanks' in blob
}

export const downloadJson = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export const parseImportText = (text: string): ExportBlob => {
  const value = JSON.parse(text) as unknown
  if (!isExportBlob(value)) throw new Error('Invalid import payload')
  return value
}

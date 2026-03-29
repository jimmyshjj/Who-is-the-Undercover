import { createFlavorLine, judgeGuessWithHost, requestPlayerAction, setupWordsWithHost } from './api'
import { getWordPairsForWordbank, toThemeLabel } from './wordbanks'
import type {
  AppSettings,
  DebugLog,
  DiscussionAction,
  GameConfig,
  GameState,
  GuessWords,
  HiddenEvent,
  HumanActionRequest,
  NightAction,
  Player,
  PlayerAction,
  PublicMessage,
  Role,
  Scoreboard,
  SetupResult,
  VoteAction,
  Wordbank,
  WinnerInfo
} from './types'

interface RuntimeContext {
  settings: AppSettings
  customWordbanks: Record<string, Wordbank>
  scoreboard: Scoreboard
  history: GameState[]
}

interface HumanActionInput {
  publicLine?: string
  privateNote?: string
  speak?: boolean
  voteTarget?: string
  knife?: boolean
  knifeTarget?: string | null
  guessWordA?: string
  guessWordB?: string
}

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`
const now = () => new Date().toISOString()
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const cloneGame = (game: GameState): GameState => JSON.parse(JSON.stringify(game)) as GameState
const renderTemplate = (template: string, variables: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '')

const shuffle = <T>(items: T[]): T[] => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = copy[i]
    copy[i] = copy[j]
    copy[j] = temp
  }
  return copy
}

const getAlivePlayers = (game: GameState) => game.players.filter(player => player.isAlive)
const getPlayerById = (game: GameState, playerId: string) => game.players.find(player => player.id === playerId) as Player
const modelForPlayer = (settings: AppSettings, player: Player) =>
  player.modelOverride || settings.playerModels[player.id] || settings.defaultPlayerModel

const secretText = (player: Player) => {
  if (player.secret.type === 'word') return `你的私密信息：${player.secret.value}`
  if (player.secret.type === 'seer_words') return `你的私密信息：两个词已打乱：${(player.secret.value as string[]).join(' / ')}`
  return `你的私密信息：你只知道领域提示：${player.secret.value}`
}

const publicHistoryText = (game: GameState) =>
  game.publicMessages.map(message => `[${message.phase}] ${message.speakerName}: ${message.text}`).join('\n') || '暂无公开历史'

const visibleStatusText = (game: GameState) => game.players.map(player =>
  `${player.id} ${player.name} - ${player.isAlive ? '存活' : '出局'}`
).join('\n')

const addPublicMessage = (
  game: GameState,
  speakerId: string,
  speakerName: string,
  phase: PublicMessage['phase'],
  messageType: PublicMessage['messageType'],
  text: string
) => {
  game.publicMessages.push({
    id: uid('msg'),
    round: game.round,
    phase,
    speakerId,
    speakerName,
    messageType,
    text,
    createdAt: now()
  })
}

const addPrivateNote = (game: GameState, playerId: string, note: string) => {
  const player = getPlayerById(game, playerId)
  if (note.trim()) player.privateNotes.push(note.trim())
}

const buildGuess = (guessWordA?: string, guessWordB?: string): GuessWords => {
  const wordA = (guessWordA || '').trim()
  const wordB = (guessWordB || '').trim()
  if (!wordA || !wordB) return null
  return { word_a: wordA, word_b: wordB }
}

const buildHumanAction = (request: HumanActionRequest, input: HumanActionInput): PlayerAction => {
  const common = {
    private_note: (input.privateNote || '').trim(),
    guess_words: buildGuess(input.guessWordA, input.guessWordB)
  }

  if (request.kind === 'description') {
    return { kind: 'description', public_line: (input.publicLine || '').trim(), ...common }
  }
  if (request.kind === 'discussion') {
    return {
      kind: 'discussion',
      speak: !!input.speak,
      public_line: input.speak ? (input.publicLine || '').trim() : '',
      ...common
    }
  }
  if (request.kind === 'day_talk') {
    return { kind: 'day_talk', public_line: (input.publicLine || '').trim(), ...common }
  }
  if (request.kind === 'vote') {
    return {
      kind: 'vote',
      vote_target: input.voteTarget || '',
      vote_reason: (input.publicLine || '').trim(),
      ...common
    }
  }
  return {
    kind: 'night',
    knife: !!input.knife,
    knife_target: input.knife ? input.knifeTarget || null : null,
    ...common
  }
}

const getCamp = (role: Role) => {
  if (role === 'undercover') return 'bad'
  if (role === 'fool') return 'independent'
  return 'good'
}

const computeRoleCounts = (totalPlayers: number) => {
  const fools = totalPlayers >= 11 ? 2 : 1
  let undercovers = Math.max(fools, Math.floor((totalPlayers - fools) / 3))
  let goods = totalPlayers - fools - undercovers
  while (!(goods > undercovers && undercovers >= fools)) {
    undercovers = Math.max(fools, undercovers - 1)
    goods = totalPlayers - fools - undercovers
    if (undercovers === fools) break
  }
  return { goods, fools, undercovers }
}

const chooseWordPair = async (
  config: GameConfig,
  settings: AppSettings,
  customWordbanks: Record<string, Wordbank>
): Promise<SetupResult> => {
  // 使用自定义词库时，主题标签固定为"自定义词库"
  const themeLabel = config.useCustomWordbank
    ? '自定义词库'
    : (config.theme === 'custom'
        ? (config.customThemeLabel?.trim() || '自定义主题')
        : toThemeLabel(config.theme))

  // 必须配置 API
  if (!settings.apiKey || !settings.hostModel) {
    throw new Error('未配置 API Key 或主持人模型，无法开始游戏')
  }

  // 使用自定义词库时：让主持人从候选中选择
  if (config.useCustomWordbank && config.customWordbankId) {
    const customBank = customWordbanks[config.customWordbankId]
    if (customBank) {
      const pairs = getWordPairsForWordbank(customBank)
      if (pairs.length > 0) {
        return await setupWordsWithHost(settings, themeLabel, config.excludeCommonWords, shuffle(pairs).slice(0, 12))
      }
    }
    throw new Error('自定义词库为空或未找到')
  }

  // 不使用自定义词库时：让 AI 主持人按主题生成词对
  return await setupWordsWithHost(settings, themeLabel, config.excludeCommonWords)
}

const buildPlayers = (config: GameConfig, settings: AppSettings, setup: SetupResult): Player[] => {
  const roleCounts = computeRoleCounts(config.totalPlayers)
  const roles: Role[] = [
    'seer',
    ...new Array(roleCounts.goods - 1).fill('villager'),
    ...new Array(roleCounts.undercovers).fill('undercover'),
    ...new Array(roleCounts.fools).fill('fool')
  ]
  const roleDeck = shuffle(roles)
  const seats = shuffle(Array.from({ length: config.totalPlayers }, (_, index) => index + 1))
  const playerIds = Array.from({ length: config.totalPlayers }, (_, index) => {
    if (config.humanPlayers > 0) {
      return index === 0 ? 'P0' : `P${index}`
    }
    return `P${index + 1}`
  })
  return Array.from({ length: config.totalPlayers }, (_, index) => {
    const id = playerIds[index]
    const role = roleDeck[index]
    let secretValue: string | string[] | null = null
    let secretType: Player['secret']['type'] = 'word'
    if (role === 'seer') {
      secretType = 'seer_words'
      secretValue = shuffle([setup.good_word, setup.undercover_word])
    } else if (role === 'fool') {
      secretType = 'domain_hint'
      secretValue = setup.domain_hint
    } else {
      secretValue = role === 'undercover' ? setup.undercover_word : setup.good_word
    }
    return {
      id,
      name: id,
      seat: seats[index],
      isHuman: index < config.humanPlayers,
      isAlive: true,
      eliminationType: null,
      role,
      secret: { type: secretType, value: secretValue },
      privateNotes: [],
      modelOverride: index < config.humanPlayers ? '' : settings.playerModels[id] || ''
    }
  })
}

const buildHumanRequest = (game: GameState, kind: HumanActionRequest['kind'], playerId: string, allowedTargets: string[] = []): HumanActionRequest => {
  const aliveIds = getAlivePlayers(game).map(player => player.id)
  const titles: Record<HumanActionRequest['kind'], string> = {
    description: '你的第一轮描述',
    discussion: `你的自由讨论动作（第 ${game.phaseSubRound} 轮）`,
    day_talk: '你的白天发言',
    vote: '你的投票',
    night: '你的夜晚动作'
  }
  return {
    playerId,
    kind,
    title: titles[kind],
    allowedTargets,
    allowKnifeTargets: aliveIds,
    allowGuess: getPlayerById(game, playerId).role === 'fool',
    subRound: game.phaseSubRound
  }
}

const buildJsonSchemaPrompt = (kind: HumanActionRequest['kind']) => {
  if (kind === 'description') return '{"kind":"description","public_line":"一句公开描述","private_note":"一句私密备注","guess_words":null}'
  if (kind === 'discussion') return '{"kind":"discussion","speak":true,"public_line":"简短公开发言","private_note":"一句私密备注","guess_words":null}'
  if (kind === 'day_talk') return '{"kind":"day_talk","public_line":"简短公开发言","private_note":"一句私密备注","guess_words":null}'
  if (kind === 'vote') return '{"kind":"vote","vote_target":"P3","vote_reason":"一句投票理由，可为空","private_note":"一句私密备注","guess_words":null}'
  return '{"kind":"night","knife":false,"knife_target":null,"private_note":"一句私密备注","guess_words":null}'
}

const buildPlayerPrompt = (
  game: GameState,
  settings: AppSettings,
  player: Player,
  kind: HumanActionRequest['kind'],
  allowedTargets: string[]
) => {
  const turnRules =
    kind === 'night'
      ? '夜晚规则：只有卧底可以安全刀人。若你不是卧底却返回 knife=true，你将立刻“自杀”出局。'
      : '描述规则：平民描述词语，卧底描述相似词语（但你不知道那是词对中的哪一个）。不要直接说出你的词。'
  const systemPrompt = renderTemplate(settings.promptTemplates.playerSystem, {
    turnRules
  })

  const userPrompt = renderTemplate(settings.promptTemplates.playerUser, {
    round: String(game.round),
    kind,
    playerId: player.id,
    secretText: secretText(player),
    privateNotes: player.privateNotes.join(' | ') || '暂无',
    publicHistory: publicHistoryText(game),
    visibleStatus: visibleStatusText(game),
    voteTargetsLine: kind === 'vote' ? `本轮可投目标：${allowedTargets.join(', ')}\n` : '',
    knifeTargetsLine: kind === 'night' ? `本轮可刀目标：${allowedTargets.join(', ')}（含你自己）\n` : '',
    jsonSchema: buildJsonSchemaPrompt(kind),
    voteReasonRule: kind === 'vote'
      ? (game.config.showVoteReasons ? '请填写 vote_reason，保持简短。\n' : 'vote_reason 留空字符串即可。\n')
      : '',
    guessRule: player.role === 'fool' ? '如果你想猜词，可在 guess_words 填入两个猜测；否则保持 null。\n' : '',
    phase: game.phase
  })

  return { systemPrompt, userPrompt }
}

const markEliminated = (game: GameState, playerId: string, eliminationType: NonNullable<Player['eliminationType']>) => {
  const player = getPlayerById(game, playerId)
  if (!player.isAlive) return
  player.isAlive = false
  player.eliminationType = eliminationType
  game.eliminatedPlayerIds.push(playerId)
}

const createDebugLog = (game: GameState, playerId: string, failType: string, rawResponse: string): DebugLog => ({
  id: uid('debug'),
  playerId,
  round: game.round,
  phase: game.phase,
  failType,
  rawResponse,
  createdAt: now()
})

const recordHiddenEvent = (
  game: GameState,
  player: Player,
  eventType: HiddenEvent['eventType'],
  summary: string,
  raw: string
) => {
  game.hiddenEvents.push({
    id: uid('hidden'),
    round: game.round,
    phase: game.phase,
    playerId: player.id,
    playerName: player.name,
    eventType,
    summary,
    raw,
    createdAt: now()
  })
}

const normalizeVoteTarget = (target: string, allowedTargets: string[]) => {
  if (allowedTargets.includes(target)) return target
  return allowedTargets[0] || ''
}

const maybeResolveGuess = async (game: GameState, context: RuntimeContext, player: Player, guessWords: GuessWords): Promise<boolean> => {
  if (!guessWords || player.role !== 'fool' || !player.isAlive) return false
  recordHiddenEvent(game, player, 'guess', 'submitted guess', JSON.stringify(guessWords))

  // 猜词裁定失败时抛出特殊错误，让外层暂停游戏等待重试
  let result
  try {
    result = await judgeGuessWithHost(context.settings, {
      goodWord: game.wordPair.goodWord,
      undercoverWord: game.wordPair.undercoverWord
    }, guessWords)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UnknownError'
    throw new Error(`JUDGE_GUESS_FAILED::${player.name} 的猜词裁定失败，请点击"继续"重试。原因：${message}`)
  }

  if (result.success) {
    recordHiddenEvent(game, player, 'guess', 'guess success', JSON.stringify(guessWords))
    game.phase = 'result'
    game.status = 'finished'
    game.pendingHumanAction = null
    game.winner = {
      camp: 'fool_exact',
      label: `${player.name} 猜中双词，白痴单独胜利`,
      playerIds: [player.id]
    }
    addPublicMessage(game, 'HOST', '主持人', 'result', 'host', `${player.name} 一记暴击，直接猜中双词。`)
    return true
  }

  recordHiddenEvent(game, player, 'guess', 'guess failed', JSON.stringify(guessWords))
  markEliminated(game, player.id, 'guess_fail')
  addPublicMessage(game, 'HOST', '主持人', game.phase, 'system', `${player.name} 已出局。`)
  return false
}

const checkVictory = (game: GameState): WinnerInfo | null => {
  if (game.phase === 'result' && game.winner) return game.winner
  const alive = getAlivePlayers(game)
  const goodAlive = alive.filter(player => getCamp(player.role) === 'good')
  const badAlive = alive.filter(player => getCamp(player.role) === 'bad')
  const independentAlive = alive.filter(player => getCamp(player.role) === 'independent')
  const goodPlayers = game.players.filter(player => getCamp(player.role) === 'good')
  const badPlayers = game.players.filter(player => getCamp(player.role) === 'bad')
  const independentPlayers = game.players.filter(player => getCamp(player.role) === 'independent')
  if (alive.length === 0) {
    return { camp: 'none', label: '所有人都倒下了', playerIds: [] }
  }
  if (goodAlive.length > 0 && badAlive.length === 0 && independentAlive.length === 0) {
    return { camp: 'good', label: '好人阵营胜利', playerIds: goodPlayers.map(player => player.id) }
  }
  if (badAlive.length > 0 && goodAlive.length === 0 && independentAlive.length === 0) {
    return { camp: 'bad', label: '卧底阵营胜利', playerIds: badPlayers.map(player => player.id) }
  }
  if (independentAlive.length > 0 && goodAlive.length === 0 && badAlive.length === 0) {
    return { camp: 'independent', label: '白痴阵营幸存到底', playerIds: independentPlayers.map(player => player.id) }
  }
  return null
}

const finalizeGameIfNeeded = (game: GameState) => {
  const winner = checkVictory(game)
  if (!winner) return false
  game.status = 'finished'
  game.phase = 'result'
  game.pendingHumanAction = null
  game.winner = winner
  return true
}

const settleSequentialAction = async (game: GameState, context: RuntimeContext, player: Player, action: PlayerAction) => {
  addPrivateNote(game, player.id, action.private_note)
  if ('public_line' in action && action.public_line.trim()) {
    addPublicMessage(game, player.id, player.name, game.phase, 'player', action.public_line.trim())
  }
  await maybeResolveGuess(game, context, player, action.guess_words)
}

const nextAliveSpeaker = (game: GameState): Player | null => {
  while (game.speakerCursor < game.speakerOrder.length) {
    const player = getPlayerById(game, game.speakerOrder[game.speakerCursor])
    if (player.isAlive) {
      game.currentSpeakerId = player.id
      return player
    }
    game.speakerCursor += 1
  }
  game.currentSpeakerId = null
  return null
}

const normalizeAction = (game: GameState, player: Player, kind: HumanActionRequest['kind'], action: PlayerAction): PlayerAction => {
  if (kind === 'vote') {
    const vote = action as VoteAction
    const allowedTargets = (game.voteState?.allowedTargets || []).filter(target => target !== player.id || game.voteState?.allowedTargets.length === 1)
    return {
      ...vote,
      vote_target: normalizeVoteTarget(vote.vote_target, allowedTargets),
      vote_reason: game.config.showVoteReasons ? (vote.vote_reason || '') : '',
      private_note: vote.private_note || ''
    }
  }
  if (kind === 'discussion') {
    const discussion = action as DiscussionAction
    return { ...discussion, public_line: discussion.speak ? discussion.public_line || '' : '' }
  }
  if (kind === 'night') {
    const night = action as NightAction
    const aliveIds = getAlivePlayers(game).map(item => item.id)
    return {
      ...night,
      knife: !!night.knife,
      knife_target: night.knife && night.knife_target && aliveIds.includes(night.knife_target) ? night.knife_target : null,
      private_note: night.private_note || ''
    }
  }
  if (kind === 'day_talk') {
    return { ...action, public_line: 'public_line' in action ? action.public_line || '' : '', private_note: action.private_note || '' } as PlayerAction
  }
  return { ...action, public_line: 'public_line' in action ? action.public_line || '' : '', private_note: action.private_note || '' } as PlayerAction
}

const phaseAfterDiscussion = async (game: GameState, settings: AppSettings) => {
  game.phase = 'vote'
  game.phaseSubRound = 0
  game.voteState = {
    attempt: 1,
    allowedTargets: getAlivePlayers(game).map(player => player.id)
  }
  game.pendingHumanAction = null
  addPublicMessage(game, 'HOST', '主持人', 'vote', 'host', await createFlavorLine(settings, 'vote', '投票阶段开启。'))
}

const phaseAfterVote = async (game: GameState, settings: AppSettings) => {
  if (finalizeGameIfNeeded(game)) return
  game.phase = 'night'
  game.phaseSubRound = 0
  game.pendingHumanAction = null
  game.voteState = null
  addPublicMessage(game, 'HOST', '主持人', 'night', 'host', await createFlavorLine(settings, 'night', '夜幕降临，所有存活玩家都将提交动作。'))
}

const phaseAfterNight = async (game: GameState, settings: AppSettings) => {
  if (finalizeGameIfNeeded(game)) return
  game.round += 1
  game.phase = 'daytalk'
  game.phaseSubRound = 0
  game.speakerCursor = 0
  game.currentSpeakerId = null
  game.pendingHumanAction = null
  addPublicMessage(game, 'HOST', '主持人', 'daytalk', 'host', await createFlavorLine(settings, 'daytalk', `第 ${game.round} 天开始。`))
}

const collectActionsForAlivePlayers = async (
  game: GameState,
  context: RuntimeContext,
  kind: HumanActionRequest['kind'],
  humanAction?: PlayerAction
): Promise<Map<string, PlayerAction>> => {
  const alivePlayers = getAlivePlayers(game)
  const actionMap = new Map<string, PlayerAction>()
  await Promise.all(alivePlayers.map(async player => {
    if (!player.isAlive) return
    if (player.isHuman) {
      if (humanAction) actionMap.set(player.id, humanAction)
      return
    }
    const allowedTargets = kind === 'vote'
      ? (game.voteState?.allowedTargets || []).filter(target => target !== player.id || getAlivePlayers(game).length === 1)
      : getAlivePlayers(game).map(p => p.id)
    const prompt = buildPlayerPrompt(game, context.settings, player, kind, allowedTargets)
    try {
      const result = await requestPlayerAction(
        context.settings,
        player,
        modelForPlayer(context.settings, player),
        prompt.systemPrompt,
        prompt.userPrompt
      )
      const normalized = normalizeAction(game, player, kind, result.action)
      actionMap.set(player.id, normalized)
      recordHiddenEvent(game, player, 'action', `${kind} action`, result.raw || JSON.stringify(normalized))
    } catch (error) {
      markEliminated(game, player.id, 'offline')
      const message = error instanceof Error ? error.message : 'UnknownError'
      const [failType, rawResponse = ''] = message.split('::')
      game.debugLogs.push(createDebugLog(game, player.id, failType, rawResponse))
      recordHiddenEvent(game, player, 'offline', `offline: ${failType}`, rawResponse)
      addPublicMessage(game, 'HOST', '主持人', game.phase, 'system', `${player.name} 离线。`)
    }
  }))
  return actionMap
}

const settleDiscussionBatch = async (game: GameState, context: RuntimeContext, actionMap: Map<string, PlayerAction>) => {
  for (const player of getAlivePlayers(game)) {
    const action = actionMap.get(player.id) as DiscussionAction | undefined
    if (!action) continue
    addPrivateNote(game, player.id, action.private_note)
    if (await maybeResolveGuess(game, context, player, action.guess_words)) return
  }
  if (finalizeGameIfNeeded(game)) return
  for (const player of getAlivePlayers(game)) {
    const action = actionMap.get(player.id) as DiscussionAction | undefined
    if (!action?.speak || !action.public_line.trim()) continue
    addPublicMessage(game, player.id, player.name, 'discussion', 'player', action.public_line.trim())
  }
}

const settleVoteBatch = async (game: GameState, settings: AppSettings, actionMap: Map<string, PlayerAction>) => {
  const tally = new Map<string, number>()
  for (const player of getAlivePlayers(game)) {
    const action = actionMap.get(player.id) as VoteAction | undefined
    if (!action) continue
    addPrivateNote(game, player.id, action.private_note)
    if (!action.vote_target) continue
    tally.set(action.vote_target, (tally.get(action.vote_target) || 0) + 1)
  }

  const ranking = [...tally.entries()].sort((a, b) => b[1] - a[1])
  for (const [playerId, count] of ranking) {
    const player = getPlayerById(game, playerId)
    recordHiddenEvent(game, player, 'vote_result', `received ${count} vote(s)`, JSON.stringify(Object.fromEntries(tally)))
  }
  if (game.config.showVoteDetails) {
    for (const voter of getAlivePlayers(game)) {
      const action = actionMap.get(voter.id) as VoteAction | undefined
      if (!action) continue
      const detail = game.config.showVoteReasons
        ? `${voter.name} -> ${action.vote_target} | ${action.vote_reason || '无理由'}`
        : `${voter.name} -> ${action.vote_target}`
      addPublicMessage(game, 'HOST', '主持人', 'vote', 'system', detail)
    }
  }
  if (ranking.length === 0) {
    addPublicMessage(game, 'HOST', '主持人', 'vote', 'system', '无人投出有效票，本轮无人出局。')
    await phaseAfterVote(game, settings)
    return
  }

  const topScore = ranking[0][1]
  const tied = ranking.filter(([, score]) => score === topScore).map(([playerId]) => playerId)
  if (tied.length > 1 && game.voteState?.attempt === 1) {
    game.voteState = { attempt: 2, allowedTargets: tied }
    addPublicMessage(game, 'HOST', '主持人', 'vote', 'system', `平票重投：${tied.join(', ')}`)
    return
  }
  if (tied.length > 1) {
    addPublicMessage(game, 'HOST', '主持人', 'vote', 'system', '再次平票，本轮无人出局。')
    await phaseAfterVote(game, settings)
    return
  }

  const eliminated = getPlayerById(game, tied[0])
  markEliminated(game, eliminated.id, 'vote')
  addPublicMessage(game, 'HOST', '主持人', 'vote', 'host', `${eliminated.name} 被投出局。`)
  await phaseAfterVote(game, settings)
}

const settleNightBatch = async (game: GameState, context: RuntimeContext, actionMap: Map<string, PlayerAction>) => {
  for (const player of [...getAlivePlayers(game)]) {
    const action = actionMap.get(player.id) as NightAction | undefined
    if (!action) continue
    addPrivateNote(game, player.id, action.private_note)
    if (await maybeResolveGuess(game, context, player, action.guess_words)) return
  }

  const deaths = new Map<string, 'night' | 'suicide'>()
  const aliveAtSettlement = getAlivePlayers(game).map(player => player.id)
  for (const playerId of aliveAtSettlement) {
    const player = getPlayerById(game, playerId)
    const action = actionMap.get(player.id) as NightAction | undefined
    if (!action?.knife) continue
    if (player.role !== 'undercover') {
      deaths.set(player.id, 'suicide')
      continue
    }
    if (action.knife_target) deaths.set(action.knife_target, 'night')
  }

  const deathList = [...deaths.entries()]
  deathList.forEach(([playerId, type]) => { markEliminated(game, playerId, type) })
  for (const player of game.players) {
    const action = actionMap.get(player.id) as NightAction | undefined
    if (action) {
      recordHiddenEvent(
        game,
        player,
        'night_result',
        action.knife ? `knife=${action.knife_target || 'null'}` : 'knife=false',
        JSON.stringify(action)
      )
    }
  }
  if (deathList.length > 0) {
    const labels = deathList.map(([playerId]) => getPlayerById(game, playerId).name).join(', ')
    addPublicMessage(game, 'HOST', '主持人', 'night', 'host', `夜色散去，${labels} 出局。`)
  } else {
    addPublicMessage(game, 'HOST', '主持人', 'night', 'system', '昨夜无人出局。')
  }
}

const processSequentialAiStep = async (game: GameState, context: RuntimeContext, kind: HumanActionRequest['kind']) => {
  const player = nextAliveSpeaker(game)
  if (!player) {
    game.pendingHumanAction = null
    return false
  }
  if (player.isHuman) {
    game.pendingHumanAction = buildHumanRequest(game, kind, player.id)
    return false
  }
  try {
    const prompt = buildPlayerPrompt(game, context.settings, player, kind, [])
    const result = await requestPlayerAction(
      context.settings,
      player,
      modelForPlayer(context.settings, player),
      prompt.systemPrompt,
      prompt.userPrompt
    )
    const normalized = normalizeAction(game, player, kind, result.action)
    recordHiddenEvent(game, player, 'action', `${kind} action`, result.raw || JSON.stringify(normalized))
    await settleSequentialAction(game, context, player, normalized)
  } catch (error) {
    markEliminated(game, player.id, 'offline')
    const message = error instanceof Error ? error.message : 'UnknownError'
    const [failType, rawResponse = ''] = message.split('::')
    game.debugLogs.push(createDebugLog(game, player.id, failType, rawResponse))
    recordHiddenEvent(game, player, 'offline', `offline: ${failType}`, rawResponse)
    addPublicMessage(game, 'HOST', '主持人', game.phase, 'system', `${player.name} 离线。`)
  }
  game.speakerCursor += 1
  if (finalizeGameIfNeeded(game)) return true
  return true
}

const applyScoreboard = (scoreboard: Scoreboard, game: GameState): Scoreboard => {
  const next = JSON.parse(JSON.stringify(scoreboard)) as Scoreboard
  for (const player of game.players) {
    next[player.name] ||= {
      playerName: player.name,
      winRounds: 0,
      loseRounds: 0
    }
    if (game.winner?.playerIds.includes(player.id)) next[player.name].winRounds += 1
    else next[player.name].loseRounds += 1
  }
  return next
}

const advanceOnce = async (game: GameState, context: RuntimeContext): Promise<boolean> => {
  game.pendingHumanAction = null

  if (game.phase === 'description') {
    const processed = await processSequentialAiStep(game, context, 'description')
    if (!processed) return false
    if (!nextAliveSpeaker(game)) {
      game.phase = 'discussion'
      game.phaseSubRound = 1
      game.speakerCursor = 0
      game.currentSpeakerId = null
      addPublicMessage(game, 'HOST', '主持人', 'discussion', 'host', await createFlavorLine(context.settings, 'discussion', '进入自由讨论。'))
    }
    return true
  }

  if (game.phase === 'daytalk') {
    const processed = await processSequentialAiStep(game, context, 'day_talk')
    if (!processed) return false
    if (!nextAliveSpeaker(game)) {
      game.phase = 'discussion'
      game.phaseSubRound = 1
      game.speakerCursor = 0
      game.currentSpeakerId = null
      addPublicMessage(game, 'HOST', '主持人', 'discussion', 'host', await createFlavorLine(context.settings, 'discussion', '白天发言结束，进入自由讨论。'))
    }
    return true
  }

  if (game.phase === 'discussion') {
    if (game.phaseSubRound > game.config.discussionRounds) {
      await phaseAfterDiscussion(game, context.settings)
      return true
    }
    const humanPlayer = getAlivePlayers(game).find(player => player.isHuman)
    if (humanPlayer) {
      game.pendingHumanAction = buildHumanRequest(game, 'discussion', humanPlayer.id)
      return false
    }
    const actions = await collectActionsForAlivePlayers(game, context, 'discussion')
    await settleDiscussionBatch(game, context, actions)
    if (finalizeGameIfNeeded(game)) return true
    game.phaseSubRound += 1
    if (game.phaseSubRound > game.config.discussionRounds) {
      await phaseAfterDiscussion(game, context.settings)
    }
    return true
  }

  if (game.phase === 'vote') {
    const humanPlayer = getAlivePlayers(game).find(player => player.isHuman)
    if (humanPlayer) {
      const allowedTargets = (game.voteState?.allowedTargets || []).filter(target => target !== humanPlayer.id || game.voteState?.allowedTargets.length === 1)
      game.pendingHumanAction = buildHumanRequest(game, 'vote', humanPlayer.id, allowedTargets)
      return false
    }
    const actions = await collectActionsForAlivePlayers(game, context, 'vote')
    await settleVoteBatch(game, context.settings, actions)
    return true
  }

  if (game.phase === 'night') {
    const humanPlayer = getAlivePlayers(game).find(player => player.isHuman)
    if (humanPlayer) {
      game.pendingHumanAction = buildHumanRequest(game, 'night', humanPlayer.id, getAlivePlayers(game).map(player => player.id))
      return false
    }
    const actions = await collectActionsForAlivePlayers(game, context, 'night')
    await settleNightBatch(game, context, actions)
    if (finalizeGameIfNeeded(game)) return true
    await phaseAfterNight(game, context.settings)
    return true
  }

  return false
}

export const createNewGame = async (config: GameConfig, context: RuntimeContext): Promise<GameState> => {
  const safeConfig: GameConfig = {
    ...config,
    totalPlayers: clamp(config.totalPlayers, 5, 15),
    humanPlayers: clamp(config.humanPlayers, 0, 1),
    aiPlayers: clamp(config.totalPlayers - config.humanPlayers, 4, 15),
    discussionRounds: clamp(config.discussionRounds, 1, 5)
  }
  if (!safeConfig.showVoteDetails) {
    safeConfig.showVoteReasons = false
  }

  const setup = await chooseWordPair(safeConfig, context.settings, context.customWordbanks)
  const players = buildPlayers(safeConfig, context.settings, setup)
  const speakerOrder = shuffle(players.map(player => player.id))
  const game: GameState = {
    gameId: uid('game'),
    status: 'running',
    round: 1,
    phase: 'description',
    phaseSubRound: 0,
    players,
    speakerOrder,
    speakerCursor: 0,
    publicMessages: [],
    eliminatedPlayerIds: [],
    wordPair: {
      goodWord: setup.good_word,
      undercoverWord: setup.undercover_word
    },
    domainHint: setup.domain_hint,
    currentSpeakerId: null,
    config: safeConfig,
    debugLogs: [],
    hiddenEvents: [],
    createdAt: now(),
    updatedAt: now(),
    pendingHumanAction: null,
    voteState: null,
    winner: null,
    historyLabel: `${toThemeLabel(safeConfig.theme)}-${setup.good_word}/${setup.undercover_word}`
  }

  addPublicMessage(game, 'HOST', '主持人', 'setup', 'host', setup.opening_line || `本局主题：${toThemeLabel(safeConfig.theme)}`)
  addPublicMessage(game, 'HOST', '主持人', 'setup', 'system', `发言顺序：${speakerOrder.join(' -> ')}`)
  addPublicMessage(game, 'HOST', '主持人', 'setup', 'system', `存活玩家：${players.map(player => player.name).join(', ')}`)
  return game
}

export const runGame = async (
  sourceGame: GameState,
  context: RuntimeContext,
  options: { stopAfterStep: boolean }
): Promise<{ game: GameState, scoreboard: Scoreboard }> => {
  const game = cloneGame(sourceGame)
  let steps = 0
  while (game.status === 'running' && !game.pendingHumanAction && steps < 200) {
    const progressed = await advanceOnce(game, context)
    game.updatedAt = now()
    steps += 1
    if (!progressed || options.stopAfterStep) break
  }

  let scoreboard = context.scoreboard
  if (game.status === 'finished' && game.winner) {
    scoreboard = applyScoreboard(scoreboard, game)
  }
  return { game, scoreboard }
}

export const submitHumanAction = async (
  sourceGame: GameState,
  context: RuntimeContext,
  input: HumanActionInput,
  options: { stopAfterStep: boolean }
): Promise<{ game: GameState, scoreboard: Scoreboard }> => {
  const game = cloneGame(sourceGame)
  if (!game.pendingHumanAction) {
    return { game, scoreboard: context.scoreboard }
  }

  const request = game.pendingHumanAction
  const human = getPlayerById(game, request.playerId)
  const action = normalizeAction(game, human, request.kind, buildHumanAction(request, input))
  recordHiddenEvent(game, human, 'action', `${request.kind} action`, JSON.stringify(action))
  game.pendingHumanAction = null

  if (request.kind === 'description' || request.kind === 'day_talk') {
    await settleSequentialAction(game, context, human, action)
    game.speakerCursor += 1
    if (!finalizeGameIfNeeded(game) && !nextAliveSpeaker(game)) {
      game.phase = 'discussion'
      game.phaseSubRound = 1
      game.speakerCursor = 0
      game.currentSpeakerId = null
      addPublicMessage(game, 'HOST', '主持人', 'discussion', 'host', await createFlavorLine(context.settings, 'discussion', '进入自由讨论。'))
    }
  } else if (request.kind === 'discussion') {
    const actions = await collectActionsForAlivePlayers(game, context, 'discussion', action)
    await settleDiscussionBatch(game, context, actions)
    if (!finalizeGameIfNeeded(game)) {
      game.phaseSubRound += 1
      if (game.phaseSubRound > game.config.discussionRounds) {
        await phaseAfterDiscussion(game, context.settings)
      }
    }
  } else if (request.kind === 'vote') {
    const actions = await collectActionsForAlivePlayers(game, context, 'vote', action)
    await settleVoteBatch(game, context.settings, actions)
  } else if (request.kind === 'night') {
    const actions = await collectActionsForAlivePlayers(game, context, 'night', action)
    await settleNightBatch(game, context, actions)
    if (!finalizeGameIfNeeded(game)) {
      await phaseAfterNight(game, context.settings)
    }
  }

  game.updatedAt = now()
  let scoreboard = context.scoreboard
  if (game.status === 'finished' && game.winner) {
    scoreboard = applyScoreboard(scoreboard, game)
  }

  if (options.stopAfterStep || game.pendingHumanAction) {
    return { game, scoreboard }
  }

  return await runGame(game, { ...context, scoreboard }, options)
}

export const revealSecret = (player: Player) => {
  if (player.secret.type === 'seer_words') return (player.secret.value as string[]).join(' / ')
  return String(player.secret.value || '')
}

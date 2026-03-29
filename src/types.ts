export type ThemeKey = 'politics' | 'history' | 'games' | 'movies' | 'anime' | 'custom'

export type GamePhase =
  | 'setup'
  | 'description'
  | 'discussion'
  | 'vote'
  | 'night'
  | 'daytalk'
  | 'result'

export type GameStatus = 'idle' | 'running' | 'finished'

export type EliminationType = null | 'vote' | 'night' | 'offline' | 'guess_fail' | 'suicide'

export type Role = 'villager' | 'seer' | 'undercover' | 'fool'

export type SecretType = 'word' | 'seer_words' | 'domain_hint'

export type MessageType = 'host' | 'player' | 'system'

export type WinnerCamp = 'good' | 'bad' | 'independent' | 'fool_exact' | 'none'

export type GuessWords = {
  word_a: string
  word_b: string
} | null

export type AppSettings = {
  baseUrl: string
  apiKey: string
  rememberApiKey: boolean
  hostModel: string
  defaultPlayerModel: string
  playerModels: Record<string, string>
  temperature: number
  timeoutMs: number
  retryCount: number
  promptTemplates: PromptTemplates
}

export type PromptTemplates = {
  hostSetupSystem: string
  hostSetupUser: string
  hostJudgeSystem: string
  hostJudgeUser: string
  hostFlavorSystem: string
  hostFlavorUser: string
  playerSystem: string
  playerUser: string
}

export type GameConfig = {
  theme: ThemeKey
  customThemeLabel?: string
  excludeCommonWords: boolean
  totalPlayers: number
  humanPlayers: number
  aiPlayers: number
  discussionRounds: number
  showVoteDetails: boolean
  showVoteReasons: boolean
  useCustomWordbank: boolean
  customWordbankId?: string
}

export type PlayerSecret = {
  type: SecretType
  value: string | string[] | null
}

export type Player = {
  id: string
  name: string
  seat: number
  isHuman: boolean
  isAlive: boolean
  eliminationType: EliminationType
  role: Role
  secret: PlayerSecret
  privateNotes: string[]
  modelOverride: string
}

export type PublicMessage = {
  id: string
  round: number
  phase: GamePhase
  speakerId: string
  speakerName: string
  messageType: MessageType
  text: string
  createdAt: string
}

export type WordPair = {
  goodWord: string
  undercoverWord: string
  domainHint: string
}

export type Wordbank = {
  id: string
  name: string
  pairs: WordPair[]
}

export type DebugLog = {
  id: string
  playerId: string
  round: number
  phase: GamePhase
  failType: string
  rawResponse: string
  createdAt: string
}

export type HiddenEvent = {
  id: string
  round: number
  phase: GamePhase
  playerId: string
  playerName: string
  eventType: 'action' | 'guess' | 'vote_result' | 'night_result' | 'offline'
  summary: string
  raw: string
  createdAt: string
}

export type ScoreRow = {
  playerName: string
  winRounds: number
  loseRounds: number
}

export type Scoreboard = Record<string, ScoreRow>

export type WordPairState = {
  goodWord: string
  undercoverWord: string
}

export type WinnerInfo = {
  camp: WinnerCamp
  label: string
  playerIds: string[]
}

export type HumanActionRequest = {
  playerId: string
  kind: 'description' | 'discussion' | 'day_talk' | 'vote' | 'night'
  title: string
  allowedTargets: string[]
  allowKnifeTargets: string[]
  allowGuess: boolean
  subRound: number
}

export type VoteState = {
  attempt: number
  allowedTargets: string[]
}

export type GameState = {
  gameId: string
  status: GameStatus
  round: number
  phase: GamePhase
  phaseSubRound: number
  players: Player[]
  speakerOrder: string[]
  speakerCursor: number
  publicMessages: PublicMessage[]
  eliminatedPlayerIds: string[]
  wordPair: WordPairState
  domainHint: string
  currentSpeakerId: string | null
  config: GameConfig
  debugLogs: DebugLog[]
  hiddenEvents: HiddenEvent[]
  createdAt: string
  updatedAt: string
  pendingHumanAction: HumanActionRequest | null
  voteState: VoteState | null
  winner: WinnerInfo | null
  historyLabel: string
}

export type ExportBlob = {
  version: number
  settings: AppSettings
  config?: GameConfig
  currentGame: GameState | null
  history: GameState[]
  scoreboard: Scoreboard
  customWordbanks: Record<string, Wordbank>
}

export type DescriptionAction = {
  kind: 'description'
  public_line: string
  private_note: string
  guess_words: GuessWords
}

export type DiscussionAction = {
  kind: 'discussion'
  speak: boolean
  public_line: string
  private_note: string
  guess_words: GuessWords
}

export type DayTalkAction = {
  kind: 'day_talk'
  public_line: string
  private_note: string
  guess_words: GuessWords
}

export type VoteAction = {
  kind: 'vote'
  vote_target: string
  private_note: string
  vote_reason?: string
  guess_words: GuessWords
}

export type NightAction = {
  kind: 'night'
  knife: boolean
  knife_target: string | null
  private_note: string
  guess_words: GuessWords
}

export type PlayerAction = DescriptionAction | DiscussionAction | DayTalkAction | VoteAction | NightAction

export type SetupResult = {
  good_word: string
  undercover_word: string
  domain_hint: string
  opening_line?: string
}

export type GuessJudgeResult = {
  success: boolean
  reason: string
}

export type FlavorResult = {
  line: string
}

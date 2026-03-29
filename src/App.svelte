<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { slide, fly, fade } from 'svelte/transition'
  import { quintOut, backOut } from 'svelte/easing'
  import {
    buildExportBlob,
    defaultConfig,
    defaultPromptTemplates,
    defaultSettings,
    downloadJson,
    loadConfig,
    loadCurrentGame,
    loadCustomWordbanks,
    loadHistory,
    loadScoreboard,
    loadSettings,
    parseImportText,
    saveConfig,
    saveCurrentGame,
    saveCustomWordbanks,
    saveHistory,
    saveScoreboard,
    saveSettings
  } from './storage'
  import { createNewGame, revealSecret, runGame, submitHumanAction } from './game'
  import { testModelConnection } from './api'
  import { getThemeOptions, getWordPairsForWordbank, normalizeWordbank } from './wordbanks'
  import type { AppSettings, GameConfig, GameState, Scoreboard, ThemeKey, Wordbank } from './types'

  let settings: AppSettings = { ...defaultSettings }
  let config: GameConfig = { ...defaultConfig }
  let currentGame: GameState | null = null
  let history: GameState[] = []
  let scoreboard: Scoreboard = {}
  let customWordbanks: Record<string, Wordbank> = {}
  let autoAdvance = true
  let busy = false
  let errorMessage = ''
  let notice = ''
  let settingsError = ''
  let settingsNotice = ''
  let importText = ''
  let customWordbankText = ''
  let humanPublicLine = ''
  let humanPrivateNote = ''
  let humanSpeak = true
  let humanVoteTarget = ''
  let humanKnife = false
  let humanKnifeTarget = ''
  let humanGuessWordA = ''
  let humanGuessWordB = ''
  let modelTestStatus: Record<string, string> = {}
  let showDebugPanel = false
  let showSettingsPanel = false
  let showPromptPanel = false
  let showHistoryPanel = true
  let showHumanPanel = true
  let isPaused = false
  let showWelcomeModal = false
  let welcomeStep = 0
  let welcomeRiskConfirmed = false
  let suppressWelcome = true

  type WelcomeStep = {
    eyebrow: string
    title: string
    paragraphs?: string[]
    bullets?: string[]
    highlight?: string
  }

  const WELCOME_STORAGE_KEY = 'welcome_dismissed_v1'
  const welcomeSteps: WelcomeStep[] = [
    {
      eyebrow: '01 / 05',
      title: '欢迎来到 AI 谁是卧底',
      paragraphs: [
        '这是一个会自动调用大模型推进对局的本地网页游戏。',
        '你可以旁观纯 AI 对局，也可以加入 1 名人类玩家亲自参与。',
        '与普通聊天页不同，本项目会在一局中多次请求模型，请先了解玩法和风险。'
      ]
    },
    {
      eyebrow: '02 / 05',
      title: '界面怎么看',
      bullets: [
        '左侧战况面板：查看阶段、存活、计分和历史。',
        '中间群聊主区：显示主持人播报、玩家发言、投票与结算。',
        '右侧人类玩家面板：启用 1 名人类玩家后，这里会出现你的回合操作。',
        '右下角设置按钮：配置 API、模型、提示词、本局参数和词库。'
      ]
    },
    {
      eyebrow: '03 / 05',
      title: '开局前先设置',
      bullets: [
        '必须先配置 Base URL、API Key、主持人模型和默认 AI 玩家模型。',
        '建议先点击“测试”确认模型连接正常。',
        '可以调整 Temperature，也可以给每个 AI 玩家单独指定模型。',
        '建议第一次先用低价模型、小人数局测试。'
      ],
      highlight: '如果 API、模型或额度设置不正确，游戏可能无法开始，或在运行中断。'
    },
    {
      eyebrow: '04 / 05',
      title: '规则与流程',
      bullets: [
        '常见角色：好人、卧底、预言家、白痴。',
        '基本目标：好人清除卧底与白痴；卧底清除好人与白痴；白痴可猜中双词单独获胜。',
        '关键规则：白痴猜词失败会立即淘汰；非卧底夜晚错误刀人会立即自杀。',
        '对局流程：开局描述 -> 自由讨论 -> 投票 -> 夜晚行动 -> 白天发言 -> 循环直到结算。'
      ],
      highlight: '阵营胜利优先，不是单纯苟活。'
    },
    {
      eyebrow: '05 / 05',
      title: '风险提示与免责',
      bullets: [
        '本项目会自动多次调用模型，异常提示词或模型行为可能导致请求次数快速增加。',
        '请务必提前设置 API 令牌额度、费用上限或账户预算，避免异常循环导致 token 消耗失控。',
        '强烈建议优先使用低成本模型测试，不建议直接使用高费用模型长时间自动跑局。',
        'API Key 理论上仅在本地浏览器中使用，但你仍应自行做好密钥保护，不要在共享或不可信环境长期保存。',
        '因模型调用、配额消耗、费用支出或异常行为造成的后果，需要由使用者自行承担。'
      ],
      highlight: '推荐首次测试：6 人局 / 1 名人类 / 低价模型 / 自动推进开启'
    }
  ]

  const promptTokenEntries = [
    { token: '{{round}}', description: '当前轮次，主要给玩家 User 模板使用。' },
    { token: '{{kind}}', description: '当前动作类型，例如 description、discussion、vote、night。' },
    { token: '{{playerId}}', description: '当前玩家编号，例如 P3。' },
    { token: '{{secretText}}', description: '当前玩家能看到的私密信息文本。' },
    { token: '{{publicHistory}}', description: '到目前为止的公开发言与系统播报。' },
    { token: '{{visibleStatus}}', description: '所有玩家当前的存活/出局状态。' },
    { token: '{{themeLabel}}', description: '主持人开局时的主题名或自定义主题名。' },
    { token: '{{candidateSection}}', description: '主持人选词时可见的候选词对列表。' },
    { token: '{{candidateSample}}', description: '兼容旧版主持人模板的变量，等同于 {{candidateSection}}。' },
    { token: '{{goodWord}}', description: '猜词裁定时的正确平民词。' },
    { token: '{{undercoverWord}}', description: '猜词裁定时的正确卧底词。' },
    { token: '{{guessA}}', description: '猜词裁定时玩家提交的第一个猜测词。' },
    { token: '{{guessB}}', description: '猜词裁定时玩家提交的第二个猜测词。' },
    { token: '{{phase}}', description: '主持人播报时所处阶段，例如 vote、night。' },
    { token: '{{facts}}', description: '主持人播报时的事实输入，用来生成一句播报。' },
    { token: '{{turnRules}}', description: '玩家 System 模板里附加的本阶段短规则。' },
    { token: '{{privateNotes}}', description: '当前玩家历史 private_note 的汇总文本。' },
    { token: '{{voteTargetsLine}}', description: '投票阶段的允许目标提示；非投票阶段通常为空。' },
    { token: '{{knifeTargetsLine}}', description: '夜晚阶段的可刀目标提示；非夜晚阶段通常为空。' },
    { token: '{{jsonSchema}}', description: '本回合要求输出的 JSON 结构示例。' },
    { token: '{{voteReasonRule}}', description: '投票理由字段是否需要填写的说明。' },
    { token: '{{guessRule}}', description: '当前玩家是否允许使用 guess_words 的说明。' }
  ]
  let selectedPromptToken = promptTokenEntries[0]

  $: config.aiPlayers = Math.max(0, config.totalPlayers - config.humanPlayers)
  $: if (!config.showVoteDetails) config.showVoteReasons = false
  $: themeOptions = getThemeOptions()
  $: customWordbankEntries = Object.values(customWordbanks)
  $: activeWordbank = config.useCustomWordbank ? customWordbanks[config.customWordbankId || ''] : undefined
  $: availableWordPairs = getWordPairsForWordbank(activeWordbank)
  $: setupModeText = config.useCustomWordbank
    ? `自定义词库（${availableWordPairs.length} 组候选，主持人从候选中选择）`
    : '主持人按主题生成词对'
  $: currentHumanPlayer = currentGame?.pendingHumanAction
    ? currentGame.players.find(player => player.id === currentGame?.pendingHumanAction?.playerId) || null
    : null
  $: currentWelcomeContent = welcomeSteps[welcomeStep]
  $: humanPlayer = currentGame?.players.find(player => player.isHuman) || null
  $: alivePlayers = currentGame ? currentGame.players.filter(player => player.isAlive).sort((a, b) => a.seat - b.seat) : []
  $: deadPlayers = currentGame ? currentGame.players.filter(player => !player.isAlive).sort((a, b) => a.seat - b.seat) : []
  $: seatOrder = currentGame ? [...currentGame.players].sort((a, b) => a.seat - b.seat) : []
  $: speakerOrder = currentGame
    ? currentGame.speakerOrder
      .map(id => currentGame?.players.find(player => player.id === id))
      .filter((player): player is NonNullable<typeof player> => !!player)
    : []

  const persistAll = () => {
    saveSettings(settings)
    saveConfig(config)
    saveCurrentGame(currentGame)
    saveHistory(history)
    saveScoreboard(scoreboard)
    saveCustomWordbanks(customWordbanks)
  }

  const clearSettingsFeedback = () => {
    settingsError = ''
    settingsNotice = ''
  }

  const readWelcomeDismissed = () => {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(WELCOME_STORAGE_KEY) === 'true'
  }

  const writeWelcomeDismissed = (value: boolean) => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(WELCOME_STORAGE_KEY, value ? 'true' : 'false')
  }

  const openWelcomeModal = (resetProgress = true) => {
    if (resetProgress) {
      welcomeStep = 0
      welcomeRiskConfirmed = false
      suppressWelcome = true
    }
    showWelcomeModal = true
  }

  const closeWelcomeModal = () => {
    writeWelcomeDismissed(suppressWelcome)
    showWelcomeModal = false
  }

  const nextWelcomeStep = () => {
    welcomeStep = Math.min(welcomeSteps.length - 1, welcomeStep + 1)
  }

  const previousWelcomeStep = () => {
    welcomeStep = Math.max(0, welcomeStep - 1)
  }

  const setSettingsNotice = (message: string) => {
    settingsError = ''
    settingsNotice = message
  }

  const setSettingsError = (message: string) => {
    settingsNotice = ''
    settingsError = message
  }

  const withBusy = async (task: () => Promise<void>, scope: 'global' | 'settings' = 'global') => {
    busy = true
    if (scope === 'settings') {
      clearSettingsFeedback()
    } else {
      errorMessage = ''
      notice = ''
    }
    try {
      await task()
      persistAll()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // 猜词裁定失败时，保存游戏状态并提示用户继续重试
      if (message.startsWith('JUDGE_GUESS_FAILED::')) {
        const userMessage = message.substring('JUDGE_GUESS_FAILED::'.length)
        notice = `⚠️ ${userMessage}`
        persistAll()
      } else {
        if (scope === 'settings') {
          setSettingsError(message)
        } else {
          errorMessage = message
        }
      }
    } finally {
      busy = false
    }
  }

  const runtimeContext = () => ({
    settings,
    customWordbanks,
    scoreboard,
    history
  })

  const syncAfterRun = (nextGame: GameState, nextScoreboard: Scoreboard) => {
    currentGame = nextGame
    scoreboard = nextScoreboard
    if (currentGame?.status === 'finished') {
      history = [currentGame, ...history.filter(item => item.gameId !== currentGame?.gameId)].slice(0, 20)
      notice = '本局已结算并写入本地历史。'
    }
  }

  const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

  const autoplayFrom = async (game: GameState) => {
    let workingGame = game
    let workingScoreboard = scoreboard
    while (workingGame.status === 'running' && !workingGame.pendingHumanAction && !isPaused) {
      const result = await runGame(workingGame, {
        settings,
        customWordbanks,
        scoreboard: workingScoreboard,
        history
      }, { stopAfterStep: true })
      workingGame = result.game
      workingScoreboard = result.scoreboard
      syncAfterRun(workingGame, workingScoreboard)
      await tick()
      if (workingGame.status !== 'running' || workingGame.pendingHumanAction || isPaused) break
      await sleep(180)
    }
    if (isPaused && workingGame.status === 'running') {
      notice = '游戏已暂停，点击"继续"恢复。'
    }
  }

  const togglePause = () => {
    isPaused = !isPaused
    if (isPaused) {
      notice = '游戏已暂停。'
    } else {
      notice = '游戏继续中...'
      if (currentGame && currentGame.status === 'running' && !currentGame.pendingHumanAction) {
        continueGame()
      }
    }
  }

  const terminateGame = () => {
    if (!currentGame) return
    isPaused = false
    const terminatedGame: GameState = {
      ...currentGame,
      status: 'finished',
      winner: {
        camp: 'none',
        label: '对局已终止',
        playerIds: []
      },
      updatedAt: new Date().toISOString()
    }
    currentGame = terminatedGame
    history = [terminatedGame, ...history.filter(item => item.gameId !== terminatedGame.gameId)].slice(0, 20)
    persistAll()
    notice = '对局已强制终止。'
    busy = false
  }

  onMount(() => {
    settings = loadSettings()
    config = loadConfig()
    currentGame = loadCurrentGame()
    history = loadHistory()
    scoreboard = loadScoreboard()
    customWordbanks = loadCustomWordbanks()
    if (!readWelcomeDismissed()) {
      openWelcomeModal()
    }
  })

  const handleThemeChange = (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value as ThemeKey
    config.theme = value
    if (value !== 'custom') {
      config.useCustomWordbank = false
      config.customThemeLabel = ''
      config.customWordbankId = ''
    }
  }

  const handleCustomWordbankToggle = (event: Event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked
    config.useCustomWordbank = checked
    if (checked) {
      config.theme = 'custom'
    } else {
      config.customWordbankId = ''
    }
  }

  const startGame = async () => {
    await withBusy(async () => {
      if (config.useCustomWordbank && !config.customWordbankId) {
        throw new Error('请先选择一个自定义词库。')
      }
      const game = await createNewGame(config, runtimeContext())
      showDebugPanel = false
      if (autoAdvance) {
        syncAfterRun(game, scoreboard)
        await autoplayFrom(game)
      } else {
        const result = await runGame(game, runtimeContext(), { stopAfterStep: true })
        syncAfterRun(result.game, result.scoreboard)
      }
    })
  }

  const continueGame = async () => {
    if (!currentGame) return
    await withBusy(async () => {
      if (autoAdvance) {
        await autoplayFrom(currentGame as GameState)
      } else {
        const result = await runGame(currentGame as GameState, runtimeContext(), { stopAfterStep: true })
        syncAfterRun(result.game, result.scoreboard)
      }
    })
  }

  const translatePhase = (phase: string): string => {
    const phaseMap: Record<string, string> = {
      'setup': '初始化',
      'description': '游戏描述',
      'discussion': '自由讨论',
      'vote': '投票环节',
      'night': '夜晚行动',
      'daytalk': '白天发言',
      'result': '结果揭晓'
    }
    return phaseMap[phase] || phase
  }

  const resetHumanForm = () => {
    humanPublicLine = ''
    humanPrivateNote = ''
    humanSpeak = true
    humanVoteTarget = ''
    humanKnife = false
    humanKnifeTarget = ''
    humanGuessWordA = ''
    humanGuessWordB = ''
  }

  const submitHuman = async () => {
    if (!currentGame?.pendingHumanAction) return
    await withBusy(async () => {
      const result = await submitHumanAction(currentGame as GameState, runtimeContext(), {
        publicLine: humanPublicLine,
        privateNote: humanPrivateNote,
        speak: humanSpeak,
        voteTarget: humanVoteTarget,
        knife: humanKnife,
        knifeTarget: humanKnife ? humanKnifeTarget : null,
        guessWordA: humanGuessWordA,
        guessWordB: humanGuessWordB
      }, { stopAfterStep: true })
      syncAfterRun(result.game, result.scoreboard)
      if (autoAdvance && result.game.status === 'running' && !result.game.pendingHumanAction) {
        await autoplayFrom(result.game)
      }
      resetHumanForm()
    })
  }

  const exportAll = () => {
    downloadJson('ai-undercover-export.json', buildExportBlob(settings, config, currentGame, history, scoreboard, customWordbanks))
  }

  const importAll = async () => {
    await withBusy(async () => {
      const payload = parseImportText(importText)
      settings = {
        ...payload.settings,
        apiKey: payload.settings.rememberApiKey ? payload.settings.apiKey : settings.apiKey
      }
      config = payload.config || { ...defaultConfig }
      currentGame = payload.currentGame
      history = payload.history
      scoreboard = payload.scoreboard
      customWordbanks = payload.customWordbanks
      setSettingsNotice('导入成功，已覆盖本地存档。')
    }, 'settings')
  }

  const importWordbank = async () => {
    await withBusy(async () => {
      const parsed = JSON.parse(customWordbankText)
      const wordbank = normalizeWordbank(parsed)
      customWordbanks = {
        ...customWordbanks,
        [wordbank.id]: wordbank
      }
      config.customWordbankId = wordbank.id
      config.theme = 'custom'
      config.useCustomWordbank = true
      setSettingsNotice(`词库 ${wordbank.name} 已保存到本地。`)
    }, 'settings')
  }

  const clearCurrentGame = () => {
    currentGame = null
    resetHumanForm()
    saveCurrentGame(null)
    notice = '当前对局已清空。'
  }

  const clearHistory = () => {
    history = []
    scoreboard = {}
    saveHistory([])
    saveScoreboard({})
    notice = '历史对局和积分表已清空。'
  }

  const resetPromptTemplatesNow = () => {
    settings = {
      ...settings,
      promptTemplates: { ...defaultPromptTemplates }
    }
    setSettingsNotice('提示词模板已恢复默认值。')
  }

  const resetAllSettings = () => {
    if (window.confirm('确定要重置所有设置吗？这包括 API Key、模型配置、提示词模板和本局参数。此操作不可撤销。')) {
      settings = { ...defaultSettings }
      config = { ...defaultConfig }
      persistAll()
      setSettingsNotice('所有设置已恢复默认。')
    }
  }

  const resetAllData = () => {
    if (window.confirm('确定要清除所有游戏数据吗？这包括当前对局、历史对局、积分表和自定义词库。此操作不可撤销。')) {
      currentGame = null
      history = []
      scoreboard = {}
      customWordbanks = {}
      persistAll()
      setSettingsNotice('所有游戏数据已清空。')
    }
  }

  const updatePlayerModel = (playerId: string, value: string) => {
    settings = {
      ...settings,
      playerModels: {
        ...settings.playerModels,
        [playerId]: value
      }
    }
  }

  const handlePlayerModelInput = (playerId: string, event: Event) => {
    updatePlayerModel(playerId, (event.currentTarget as HTMLInputElement).value)
  }

  const saveSettingsNow = () => {
    saveSettings(settings)
    saveConfig(config)
    setSettingsNotice('设置已保存到本地。')
  }

  const testModel = async (key: string, model: string) => {
    await withBusy(async () => {
      const trimmed = model.trim()
      if (!trimmed) throw new Error('请先填写模型名称。')
      modelTestStatus = {
        ...modelTestStatus,
        [key]: '测试中...'
      }
      await tick()
      const reply = await testModelConnection(settings, trimmed)
      modelTestStatus = {
        ...modelTestStatus,
        [key]: `通过: ${reply}`
      }
      setSettingsNotice(`${trimmed} 连接正常。回复：${reply}`)
    }, 'settings')
  }
</script>

<svelte:head>
  <title>AI 谁是卧底</title>
</svelte:head>

<div class="app-shell" class:paused={isPaused} class:busy={busy}>
  <header class="hero-strip">
    <div class="hero-copy">
      <h1>AI 谁是卧底</h1>
      <p class="subline">本地群聊推理局。支持纯 AI 自动跑局，也支持 1 位人类玩家在右侧独立行动面板中接管自己的回合。</p>
    </div>
    <div class="top-actions">
      <button class="btn" on:click={startGame} disabled={busy || (currentGame?.status === 'running')}>开始新局</button>
      {#if (currentGame && currentGame.status === 'running') || busy}
        {#if isPaused}
          <button class="btn btn-secondary" on:click={togglePause}>▶ 继续</button>
        {:else}
          <button class="btn btn-ghost" on:click={togglePause}>⏸ 暂停</button>
        {/if}
        <button class="btn btn-secondary" on:click={continueGame} disabled={busy || isPaused}>推进</button>
        <button class="btn btn-danger" on:click={terminateGame}>✕ 终止</button>
      {/if}
    </div>
  </header>

  {#if errorMessage}
    <div class="banner error">{errorMessage}</div>
  {/if}
  {#if notice}
    <div class="banner notice">{notice}</div>
  {/if}

  <main class="layout">
    <aside class="panel left-panel">
      <div class="panel-head"><span>⚔️ 战况面板</span></div>
      {#if currentGame}
        <div class="slab big" in:fly={{ y: -10, duration: 300 }}>
          <div class="label">🎯 当前阶段</div>
          <div class="value">{translatePhase(currentGame.phase)}</div>
          <div class="meta">第 {currentGame.round} 轮 {#if currentGame.phaseSubRound} / 讨论子轮 {currentGame.phaseSubRound}{/if}</div>
        </div>

        <div class="slab">
          <div class="label">💚 存活玩家</div>
          {#each alivePlayers as player, i}
            <div class="player-row alive" in:fly={{ x: -10, duration: 200, delay: i * 30 }}>
              <span>{player.name}</span>
              <span>Seat {player.seat}</span>
            </div>
          {/each}
        </div>

        <div class="slab">
          <div class="label">💀 已出局</div>
          {#if deadPlayers.length === 0}
            <div class="muted">暂无</div>
          {:else}
            {#each deadPlayers as player}
              <div class="player-row dead">
                <span style="text-decoration: line-through;">{player.name}</span>
                <span>已出局</span>
              </div>
            {/each}
          {/if}
        </div>

        <div class="slab">
          <div class="label">🎙️ 发言顺序</div>
          {#each speakerOrder as player, i}
            <div class:current={currentGame.currentSpeakerId === player?.id} class="player-row order" in:fly={{ x: -10, duration: 200, delay: i * 30 }}>
              <span>{player?.name}</span>
              <span>{player?.id}</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="slab" in:fade={{ duration: 300 }}>
          <div class="label">📋 状态</div>
          <div class="muted">尚未开始新局。</div>
        </div>
      {/if}

      <div class="slab">
        <div class="label">🏆 计分表</div>
        {#if Object.values(scoreboard).length === 0}
          <div class="muted">暂无战绩</div>
        {:else}
          {#each Object.values(scoreboard).sort((a, b) => b.winRounds - a.winRounds) as row, i}
            <div class="score-row" in:fly={{ x: -10, duration: 200, delay: i * 30 }}>
              <span>{row.playerName}</span>
              <span>{row.winRounds}W / {row.loseRounds}L</span>
            </div>
          {/each}
        {/if}
      </div>

      <div class="slab">
        <div class="slab-head">
          <div class="label">📜 历史对局</div>
          <div class="slab-actions">
            <button class="btn btn-ghost small toggle-btn" class:collapsed={!showHistoryPanel} type="button" on:click={() => { showHistoryPanel = !showHistoryPanel }}>
              {showHistoryPanel ? '折叠' : '展开'}
            </button>
            <button class="btn btn-ghost small" type="button" on:click={clearHistory}>清空</button>
          </div>
        </div>
        {#if showHistoryPanel}
          <div transition:slide={{ duration: 300, easing: quintOut }}>
            {#if history.length === 0}
              <div class="muted">暂无历史</div>
            {:else}
              {#each history.slice(0, 5) as item, i}
                <div class="history-row" in:fly={{ x: -20, duration: 200, delay: i * 50 }}>
                  <strong>{item.historyLabel}</strong>
                  <span>{item.winner?.label || '未结算'}</span>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </aside>

    <section class="panel chat-panel">
      <div class="panel-head">
        <span>💬 群聊主区</span>
        <div class="inline-controls">
          <label class="toggle">
            <input type="checkbox" bind:checked={autoAdvance} />
            <span>自动推进</span>
          </label>
          {#if currentGame}
            <button class="btn btn-ghost small" on:click={clearCurrentGame}>清空当前局</button>
          {/if}
        </div>
      </div>

      <div class="chat-log">
        {#if !currentGame}
          <div class="empty-state">
            <h2>准备就绪</h2>
            <p>点击右下角的 ⚙️ 按钮配置接口、模型和本局参数，然后点击顶部“开始新局”。</p>
            <p class="muted">
              本局支持 AI 自动创作词对（基于选定主题）或从自定义词库中抽取。
              开启“排除常见词”后，主持人将从过滤后的候选池中挑选。
            </p>
          </div>
        {:else}
          {#each currentGame.publicMessages as message}
            <article class="message-card {message.messageType}">
              <div class="message-meta">
                <span>{message.speakerName}</span>
                <span>R{message.round} / {message.phase}</span>
              </div>
              <div class="message-text">{message.text}</div>
            </article>
          {/each}
        {/if}
      </div>

      {#if currentGame?.status === 'finished'}
        <div class="result-banner">
          <h2>{currentGame.winner?.label}</h2>
          <p>词对揭示：{currentGame.wordPair.goodWord} / {currentGame.wordPair.undercoverWord}</p>
          <button class="btn btn-ghost small" type="button" on:click={() => { showDebugPanel = !showDebugPanel }}>
            {showDebugPanel ? '隐藏 Debug' : '显示 Debug'}
          </button>
          <div class="result-grid">
            {#each seatOrder as player}
              <div class="result-card">
                <strong>{player.name}</strong>
                <span>{player.role}</span>
                <span>{revealSecret(player)}</span>
              </div>
            {/each}
          </div>
          {#if showDebugPanel}
            <div class="debug-panel">
              <div class="label">隐藏动作与原始内容</div>
              {#if currentGame.hiddenEvents.length === 0 && currentGame.debugLogs.length === 0}
                <div class="muted">暂无调试数据</div>
              {/if}
              {#each currentGame.hiddenEvents as item}
                <div class="debug-card">
                  <strong>{item.playerName} / {item.eventType}</strong>
                  <span>R{item.round} / {item.phase}</span>
                  <span>{item.summary}</span>
                  <pre>{item.raw}</pre>
                </div>
              {/each}
              {#each currentGame.debugLogs as log}
                <div class="debug-card">
                  <strong>{log.playerId} / offline</strong>
                  <span>R{log.round} / {log.phase}</span>
                  <span>{log.failType}</span>
                  <pre>{log.rawResponse}</pre>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <aside class="panel right-panel">
      <div class="panel-head">
        <span>🎮 人类玩家面板</span>
      </div>

      {#if humanPlayer}
        <div class="slab human-status-panel" in:fly={{ x: 20, duration: 300 }}>
          <div class="label">👤 你的状态</div>
          <div class="human-info">
            <div class="info-item">
              <span class="info-label">私密信息：</span>
              <span class="info-value">{revealSecret(humanPlayer)}</span>
            </div>
            {#if !humanPlayer.isAlive}
              <div class="info-item status-out">你已出局</div>
            {/if}
          </div>
        </div>
      {/if}

      {#if currentGame?.pendingHumanAction && currentHumanPlayer}
        <div class="slab danger human-panel" in:fly={{ y: -20, duration: 400, easing: backOut }}>
          <div class="slab-head">
            <div class="label">🎮 行动面板</div>
            <button class="btn btn-ghost small toggle-btn" class:collapsed={!showHumanPanel} type="button" on:click={() => { showHumanPanel = !showHumanPanel }}>
              {showHumanPanel ? '折叠' : '展开'}
            </button>
          </div>

          {#if showHumanPanel}
            <div transition:slide={{ duration: 300, easing: quintOut }}>
              <div class="human-summary">
                <strong>{currentHumanPlayer.name}</strong>
                <span>{currentGame.pendingHumanAction.title}</span>
              </div>

            {#if currentGame.pendingHumanAction.kind === 'discussion'}
              <label class="inline-check">
                <input type="checkbox" bind:checked={humanSpeak} />
                <span>本轮发言</span>
              </label>
            {/if}

            {#if currentGame.pendingHumanAction.kind === 'vote'}
              <label>
                <span>投票目标</span>
                <select bind:value={humanVoteTarget}>
                  <option value="">请选择</option>
                  {#each currentGame.pendingHumanAction.allowedTargets as target}
                    <option value={target}>{target}</option>
                  {/each}
                </select>
              </label>
              {#if currentGame.config.showVoteReasons}
                <label><span>投票理由</span><textarea bind:value={humanPublicLine} rows="3" placeholder="一句短理由"></textarea></label>
              {/if}
            {/if}

            {#if currentGame.pendingHumanAction.kind === 'night'}
              <label class="inline-check">
                <input type="checkbox" bind:checked={humanKnife} />
                <span>尝试刀人</span>
              </label>
              {#if humanKnife}
                <label>
                  <span>刀人目标</span>
                  <select bind:value={humanKnifeTarget}>
                    <option value="">请选择</option>
                    {#each currentGame.pendingHumanAction.allowKnifeTargets as target}
                      <option value={target}>{target}</option>
                    {/each}
                  </select>
                </label>
              {/if}
            {/if}

            {#if currentGame.pendingHumanAction.kind !== 'vote'}
              <label><span>公开发言</span><textarea bind:value={humanPublicLine} rows="3" placeholder="一句短发言"></textarea></label>
            {/if}

            <label><span>私密备注</span><textarea bind:value={humanPrivateNote} rows="3" placeholder="仅自己可见"></textarea></label>

            {#if currentGame.pendingHumanAction.allowGuess}
              <div class="grid-two">
                <label><span>猜词 A</span><input bind:value={humanGuessWordA} placeholder="可选" /></label>
                <label><span>猜词 B</span><input bind:value={humanGuessWordB} placeholder="可选" /></label>
              </div>
            {/if}

            <div class="private-notes">
              <div class="label small">你的过往 private notes</div>
              {#if currentHumanPlayer.privateNotes.length === 0}
                <div class="muted">暂无</div>
              {:else}
                {#each currentHumanPlayer.privateNotes as note}
                  <div class="note-chip">{note}</div>
                {/each}
              {/if}
            </div>

            <button class="btn full" on:click={submitHuman} disabled={busy}>提交动作</button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="slab human-panel-placeholder">
          <div class="muted">
            {#if config.humanPlayers === 0}
              当前无人类玩家参与
            {:else if !currentGame}
              开始游戏后将显示行动面板
            {:else}
              等待你的回合...
            {/if}
          </div>
        </div>
      {/if}
    </aside>
  </main>

  <!-- 设置悬浮按钮 -->
  <button class="settings-fab" on:click={() => { clearSettingsFeedback(); showSettingsPanel = true }} title="打开设置">
    ⚙️
  </button>

  <!-- 设置弹窗 -->
  {#if showSettingsPanel}
    <div class="modal-overlay" on:click={() => { clearSettingsFeedback(); showSettingsPanel = false }} on:keydown={(e) => e.key === 'Escape' && (clearSettingsFeedback(), showSettingsPanel = false)} role="dialog" aria-modal="true" transition:fade={{ duration: 200 }}>
      <div class="modal-content settings-modal" on:click|stopPropagation on:keydown={(e) => e.key === 'Escape' && (clearSettingsFeedback(), showSettingsPanel = false)} role="document" in:fly={{ y: 50, duration: 300, easing: backOut }}>
        <div class="modal-header">
          <h2>🔧 游戏设置</h2>
          <button class="modal-close" on:click={() => { clearSettingsFeedback(); showSettingsPanel = false }} title="关闭">✕</button>
        </div>
        <div class="modal-body">
          {#if settingsError}
            <div class="banner error">{settingsError}</div>
          {/if}
          {#if settingsNotice}
            <div class="banner notice">{settingsNotice}</div>
          {/if}
          <div transition:slide={{ duration: 350, easing: quintOut }}>
          <div class="slab" in:fly={{ x: 20, duration: 300, delay: 0 }}>
            <div class="label">⚙️ 应用设置</div>
          <label><span>Base URL</span><input bind:value={settings.baseUrl} placeholder="https://api.openai.com/v1" /></label>
          <label><span>API Key</span><input bind:value={settings.apiKey} type="password" placeholder="sk-..." /></label>
          <label class="inline-check">
            <input type="checkbox" bind:checked={settings.rememberApiKey} />
            <span>本地记住 API Key</span>
          </label>
          <label>
            <span>主持人模型</span>
            <div class="field-with-action">
              <input bind:value={settings.hostModel} placeholder="gpt-4o-mini" />
              <button class="btn btn-ghost small" type="button" on:click={() => testModel('hostModel', settings.hostModel)} disabled={busy}>测试</button>
            </div>
          </label>
          <label>
            <span>默认 AI 玩家模型</span>
            <div class="field-with-action">
              <input bind:value={settings.defaultPlayerModel} placeholder="gpt-4o-mini" />
              <button class="btn btn-ghost small" type="button" on:click={() => testModel('defaultPlayerModel', settings.defaultPlayerModel)} disabled={busy}>测试</button>
            </div>
          </label>
          <div class="grid-two">
            <label><span>Temperature</span><input bind:value={settings.temperature} type="number" min="0" max="2" step="0.1" /></label>
            <label><span>超时 (ms)</span><input bind:value={settings.timeoutMs} type="number" min="5000" step="1000" /></label>
          </div>
          <div class="grid-two">
            <label><span>重试次数</span><input bind:value={settings.retryCount} type="number" min="0" max="5" /></label>
          </div>
        </div>

        <div class="slab" in:fly={{ x: 20, duration: 300, delay: 50 }}>
          <div class="label">🎲 本局参数</div>
          <div class="field-status">{setupModeText}</div>
          <label class="inline-check">
            <input type="checkbox" checked={config.useCustomWordbank} on:change={handleCustomWordbankToggle} />
            <span>使用自定义词库</span>
          </label>
          {#if config.useCustomWordbank}
            <label>
              <span>自定义词库</span>
              <select bind:value={config.customWordbankId}>
                <option value="">请选择</option>
                {#each customWordbankEntries as bank}
                  <option value={bank.id}>{bank.name}</option>
                {/each}
              </select>
            </label>
          {:else}
            <label>
              <span>主题</span>
              <select value={config.theme} on:change={handleThemeChange}>
                {#each themeOptions as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
            {#if config.theme === 'custom'}
              <label>
                <span>自定义主题</span>
                <input
                  bind:value={config.customThemeLabel}
                  placeholder="例如：硬核科幻、经典文学、校园生活"
                />
              </label>
            {/if}
            <label class="inline-check">
              <input type="checkbox" bind:checked={config.excludeCommonWords} />
              <span>排除常见词</span>
            </label>
          {/if}
          <div class="grid-two">
            <label><span>总人数</span><input bind:value={config.totalPlayers} type="number" min="5" max="15" /></label>
            <label><span>人类人数</span><input bind:value={config.humanPlayers} type="number" min="0" max="1" /></label>
          </div>
          <div class="grid-two">
            <label><span>AI 人数</span><input value={config.aiPlayers} disabled /></label>
            <label><span>自由讨论轮数</span><input bind:value={config.discussionRounds} type="number" min="1" max="5" /></label>
          </div>
          <label class="inline-check">
            <input type="checkbox" bind:checked={config.showVoteDetails} />
            <span>显示投票详情</span>
          </label>
          <label class="inline-check">
            <input type="checkbox" bind:checked={config.showVoteReasons} disabled={!config.showVoteDetails} />
            <span>显示投票理由</span>
          </label>
        </div>

        <div class="slab" in:fly={{ x: 20, duration: 300, delay: 100 }}>
          <div class="slab-head">
            <div class="label">📝 提示词模板</div>
            <div class="slab-actions">
              <button class="btn btn-ghost small" type="button" on:click={resetPromptTemplatesNow}>恢复默认</button>
              <button class="btn btn-ghost small toggle-btn" class:collapsed={!showPromptPanel} type="button" on:click={() => { showPromptPanel = !showPromptPanel }}>
                {showPromptPanel ? '折叠' : '展开'}
              </button>
            </div>
          </div>
          <p class="panel-copy">这里可以直接调整主持人与玩家的提示词模板，改完后点击顶部“保存设置”即可持久化。</p>
          <div class="tag-list compact">
            {#each promptTokenEntries as entry}
              <button
                class="tag"
                class:active={selectedPromptToken.token === entry.token}
                type="button"
                on:click={() => { selectedPromptToken = entry }}
                title="点击查看说明"
              >{entry.token}</button>
            {/each}
          </div>
          <div class="token-help">
            <strong>{selectedPromptToken.token}</strong>
            <span>{selectedPromptToken.description}</span>
          </div>
          {#if showPromptPanel}
            <div transition:slide={{ duration: 300, easing: quintOut }}>
              <label><span>主持人开局 System</span><textarea bind:value={settings.promptTemplates.hostSetupSystem} rows="3" /></label>
              <label><span>主持人开局 User</span><textarea bind:value={settings.promptTemplates.hostSetupUser} rows="6" /></label>
              <label><span>猜词裁定 System</span><textarea bind:value={settings.promptTemplates.hostJudgeSystem} rows="3" /></label>
              <label><span>猜词裁定 User</span><textarea bind:value={settings.promptTemplates.hostJudgeUser} rows="5" /></label>
              <label><span>播报 System</span><textarea bind:value={settings.promptTemplates.hostFlavorSystem} rows="3" /></label>
              <label><span>播报 User</span><textarea bind:value={settings.promptTemplates.hostFlavorUser} rows="4" /></label>
              <label><span>玩家 System</span><textarea bind:value={settings.promptTemplates.playerSystem} rows="4" /></label>
              <label><span>玩家 User</span><textarea bind:value={settings.promptTemplates.playerUser} rows="10" /></label>
            </div>
          {/if}
        </div>

        <div class="slab" in:fly={{ x: 20, duration: 300, delay: 150 }}>
          <div class="label">🤖 每位玩家独立模型</div>
          {#each Array.from({ length: 15 }, (_, index) => `P${index + 1}`) as playerId}
            <label class="player-model-row">
              <span>{playerId}</span>
              <div class="field-with-action compact">
                <input
                  value={settings.playerModels[playerId] || ''}
                  placeholder="留空则跟随默认模型"
                  on:input={(event) => handlePlayerModelInput(playerId, event)}
                />
                <button
                  class="btn btn-ghost small"
                  type="button"
                  on:click={() => testModel(playerId, settings.playerModels[playerId] || settings.defaultPlayerModel)}
                  disabled={busy}
                >测试</button>
              </div>
            </label>
          {/each}
        </div>

        <div class="slab" in:fly={{ x: 20, duration: 300, delay: 200 }}>
          <div class="label">📦 导入导出 / 词库</div>
          <textarea bind:value={importText} rows="6" placeholder="粘贴完整导出 JSON 后点击覆盖导入"></textarea>
          <div class="grid-two">
            <button class="btn btn-secondary full" on:click={exportAll}>导出 JSON</button>
            <button class="btn btn-secondary full" on:click={importAll} disabled={busy}>覆盖导入</button>
          </div>
          <textarea
            bind:value={customWordbankText}
            rows="6"
            placeholder={'粘贴单个词库 JSON，例如 {"name":"我的词库","themes":{"games":[["词A","词B","提示"]]}}'}
          />
          <button class="btn btn-ghost full" on:click={importWordbank} disabled={busy}>保存词库到本地</button>
        </div>

        <div class="slab danger" in:fly={{ x: 20, duration: 300, delay: 250 }}>
          <div class="label">⚠️ 危险区域</div>
          <p class="panel-copy">以下操作不可撤销，请谨慎操作。</p>
          <button class="btn btn-ghost full" type="button" on:click={() => { clearSettingsFeedback(); openWelcomeModal() }}>重新查看欢迎引导</button>
          <div class="grid-two">
            <button class="btn btn-danger full" on:click={resetAllSettings}>重置所有设置</button>
            <button class="btn btn-danger full" on:click={resetAllData}>清除所有数据</button>
          </div>
        </div>
          </div>
        </div>
  <div class="modal-footer">
    <button class="btn" on:click={saveSettingsNow}>保存设置</button>
    <button class="btn btn-ghost" on:click={() => { clearSettingsFeedback(); showSettingsPanel = false }}>关闭</button>
  </div>
      </div>
    </div>
  {/if}

  {#if showWelcomeModal}
    <div class="modal-overlay" role="dialog" aria-modal="true" transition:fade={{ duration: 200 }}>
      <div class="modal-content welcome-modal" role="document" in:fly={{ y: 40, duration: 280, easing: backOut }}>
        <div class="modal-header welcome-header">
          <div class="welcome-title-wrap">
            <div class="welcome-eyebrow">{currentWelcomeContent.eyebrow}</div>
            <h2>{currentWelcomeContent.title}</h2>
          </div>
          <button class="modal-close" type="button" on:click={closeWelcomeModal} title="跳过">✕</button>
        </div>
        <div class="modal-body welcome-body">
          {#if welcomeStep === 1}
            <div class="welcome-hero">
              <div class="welcome-map">
                <div class="welcome-card">战况 / 计分 / 历史</div>
                <div class="welcome-card main">群聊主区 / 对局播报</div>
                <div class="welcome-card">人类玩家面板</div>
              </div>
            </div>
          {/if}

          {#if currentWelcomeContent.paragraphs}
            <div class="welcome-copy">
              {#each currentWelcomeContent.paragraphs as paragraph}
                <p>{paragraph}</p>
              {/each}
            </div>
          {/if}

          {#if currentWelcomeContent.bullets}
            <div class="welcome-copy">
              {#each currentWelcomeContent.bullets as bullet}
                <div class="welcome-bullet">{bullet}</div>
              {/each}
            </div>
          {/if}

          {#if currentWelcomeContent.highlight}
            <div class:danger={welcomeStep === welcomeSteps.length - 1} class="welcome-highlight">
              {currentWelcomeContent.highlight}
            </div>
          {/if}

          {#if welcomeStep === welcomeSteps.length - 1}
            <label class="inline-check welcome-check">
              <input type="checkbox" bind:checked={welcomeRiskConfirmed} />
              <span>我已了解费用、额度与密钥风险，并会先设置限制。</span>
            </label>
            <label class="inline-check welcome-check muted-check">
              <input type="checkbox" bind:checked={suppressWelcome} />
              <span>下次不再显示</span>
            </label>
          {/if}
        </div>
        <div class="modal-footer">
          {#if welcomeStep > 0}
            <button class="btn btn-ghost" type="button" on:click={previousWelcomeStep}>上一步</button>
          {/if}
          {#if welcomeStep < welcomeSteps.length - 1}
            <button class="btn btn-ghost" type="button" on:click={closeWelcomeModal}>跳过</button>
            <button class="btn" type="button" on:click={nextWelcomeStep}>下一步</button>
          {:else}
            <button class="btn" type="button" on:click={closeWelcomeModal} disabled={!welcomeRiskConfirmed}>我知道了</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

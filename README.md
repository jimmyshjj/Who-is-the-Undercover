# AI Undercover Web

一个基于 Svelte + TypeScript + Vite 的本地网页游戏项目，用大模型驱动“谁是卧底”多人对局。

你可以旁观纯 AI 对局，也可以加入 1 名人类玩家参与发言、投票和夜晚行动。

## 功能概览

- 支持纯 AI 跑局，也支持 1 名人类玩家参与。
- 支持主持人模型、默认 AI 玩家模型、每位 AI 玩家单独模型。
- 支持调整 `Temperature`、超时时间、重试次数。
- 支持自定义提示词模板：
  - 主持人选词
  - 猜词裁定
  - 主持人播报
  - AI 玩家 System / User
- 支持内置主题和自定义词库。
- 支持导入导出设置、当前对局、历史和词库。
- 支持历史战绩与积分表。
- 支持首次欢迎引导与风险提示。
- 所有本地数据默认保存在浏览器 `localStorage`。

## 游戏规则

当前版本包含这些常见角色：

- `villager`：普通好人，拿到平民词。
- `seer`：预言家，知道两个词，但顺序会被打乱。
- `undercover`：卧底，拿到卧底词。
- `fool`：白痴，只知道领域提示。

大致目标如下：

- 好人阵营：清除卧底与白痴。
- 卧底阵营：清除好人与白痴。
- 白痴：尝试准确猜中双词单独获胜，或成为场上最后仅存阵营。

关键规则：

- 白痴猜词失败会立即淘汰。
- 非卧底如果在夜晚执行刀人，会立即自杀出局。
- 阵营胜利优先，不是单纯保命。
- 计分表按最终阵营胜负计算，不要求玩家必须存活到最后。

常见流程：

1. 主持人生成或选择词对。
2. 玩家按顺序进行开局描述。
3. 进入自由讨论。
4. 所有人投票。
5. 夜晚结算。
6. 白天发言。
7. 循环直到胜负产生。

## API 请求格式

当前项目统一走 OpenAI-compatible 的 `/chat/completions` 接口。

请求体格式大致如下：

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.7
}
```

当前版本保留了这些可配置项：

- `baseUrl`
- `apiKey`
- `hostModel`
- `defaultPlayerModel`
- `playerModels`
- `temperature`
- `timeoutMs`
- `retryCount`

当前版本没有内置多 provider 适配层，也没有 Gemini / Anthropic 专用请求格式。若要接入其他协议，需要额外扩展 `src/api.ts`。

## 使用前警告

这是一个会自动多次调用模型的游戏，不是一次请求结束的普通聊天页。开始使用前请务必注意：

- 请先为 API 账户设置令牌额度、预算上限或费用限制。
- 程序异常、提示词异常或模型行为异常时，可能导致请求快速增加。
- 强烈建议先使用低成本模型进行小规模测试。
- 不建议直接使用高费用模型长时间自动跑局。
- API Key 理论上只在浏览器本地使用，但你仍应自行做好密钥保护。
- 不要在共享设备、不可信环境或公开页面中长期保存 Key。

## 快速开始

安装依赖：

```bash
npm ci
```

启动开发环境：

```bash
npm run dev
```

构建生产版本：

```bash
npm run build
```

类型检查：

```bash
npm run check
```

## 首次使用建议

建议第一次按这个顺序测试：

1. 打开设置，填写 `Base URL`、`API Key`、主持人模型和默认玩家模型。
2. 先点击“测试”确认接口连通。
3. 优先使用便宜模型。
4. 先开小局，例如 5 到 6 人。
5. 跑一局确认对话、投票和结算都正常，再逐步增加人数或更换模型。

## 项目结构

主要代码集中在这些文件：

- `src/App.svelte`：主界面、设置弹窗、欢迎引导、对局交互。
- `src/game.ts`：游戏状态机、角色分配、阶段推进、人类动作处理、胜负与计分。
- `src/api.ts`：OpenAI-compatible 请求封装、主持人选词、玩家行动、裁定与连通性测试。
- `src/storage.ts`：默认设置、提示词模板、本地存储读写、导入导出。
- `src/wordbanks.ts`：词库与主题处理。
- `src/types.ts`：核心类型定义。

## 本地数据

以下内容默认保存在浏览器本地：

- 应用设置
- 当前对局
- 历史对局
- 计分表
- 自定义词库

清空浏览器站点数据后，这些内容会一起丢失。

## Credits

While certain foundations of this project were forked from [Niek/chatgpt-web](https://github.com/Niek/chatgpt-web) licensed under GPL-3.0 license, the codebase has been largely rewritten.

This project depends on the following tools: [Codex](https://openai.com/codex/) & [Copilot](https://github.com/github/copilot-cli) & [Gemini-CLI](https://github.com/google-gemini/gemini-cli).
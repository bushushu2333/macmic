<div align="center">
  <img src="assets/macmic.svg" width="88" alt="macmic logo" />
  <h1>macmic · 麦麦</h1>
  <p><strong>说出来，就好。</strong></p>
  <p>给 macOS 和 Windows 的语音输入工具。</p>
  <p>Qwen3-ASR / 豆包流式语音 · 毛玻璃界面 · 实时波形 · 专有词库</p>
</div>

麦麦把你的声音转成文字，输入到当前光标所在的位置。平时留在菜单栏 / 系统托盘，录音时出现一个简洁的波形浮条，完成后自动收起。

默认使用本机 Qwen3-ASR，也可在设置中选择豆包流式语音并填写自己的凭据。选择豆包后，录音和专有词库会发送到火山引擎语音服务；不需要安装 Python 或本地模型。麦麦不会在两种识别方式间自动切换。

文字整理是独立的可选功能，默认关闭；开启后，识别文字和词库会发送到你配置的 OpenAI-compatible 服务，录音不会发送给文字整理服务。

## 能做什么

- **本地识别**：两端均使用 Qwen3-ASR 1.7B；Mac 通过 MLX 使用 Apple GPU，Windows 使用 PyTorch，默认 CPU。
- **可选豆包流式识别**：边录音边发送，结束时获得最终识别结果；短句也使用最终精修结果。需要自己的火山引擎语音账户和额度。
- **毛玻璃界面**：Mac 原生模糊侧栏、统一圆角与留白，Windows 使用同一布局与半透明视觉。
- **安静的录音浮条**：真实麦克风波形、录音计时，保留当前应用的键盘焦点。
- **全局输入**：快捷键或菜单栏开始/结束；Esc 取消，取消后的迟到结果不会再输入。
- **专有词库**：人名、品牌和术语可自行添加，供识别和文字整理参考。
- **可选文字整理**：去掉无意义重复，保留原意；整理失败或 12 秒超时回退原文。
- **输入记录**：在本机查看最近 100 条记录，复制文字、对照识别原文。
- **后台常驻**：关闭/最小化面板后仍可输入，菜单栏提供退出入口。

本地模式在录音结束后识别；豆包模式实时上传音频，结束后一次性输入最终文字，不在当前输入框中反复改写中间结果。单次录音最长 5 分钟。取消会停止后续发送并丢弃结果；已经发送到云端的音频无法撤回。

## 选择你的平台

| 平台 | 运行方式 | 安装入口 |
| --- | --- | --- |
| macOS 14+ / Apple Silicon | MLX · 8-bit · Apple GPU | [Mac 安装说明](docs/MACOS.md) |
| Windows 10/11 x64 | PyTorch · CPU；可选 NVIDIA CUDA | [Windows 安装说明](docs/WINDOWS.md) |

两端共用页面、波形、词库和录音流程。Windows 安装包在 [Releases](https://github.com/bushushu2333/macmic/releases)；本地模式需要另行安装模型，豆包模式只需填写凭据。

## 豆包语音配置

在“设置 → 语音识别”选择豆包，填写自己的 App ID、Access Key 和 Resource ID，保存后生效。默认资源 ID 为 `volc.seedasr.sauc.duration`，需与账户开通的服务匹配。凭据留空不会清除已保存的密钥。“已配置”表示信息已保存，实际可用性会在录音连接时检查。

接口固定使用官方 `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`，发送 16 kHz 单声道 PCM，每 200ms 一个音频块，并启用最终精修；详见 [火山引擎语音文档](https://www.volcengine.com/docs/6561/1354869)。网络中断或鉴权失败会显示错误，不会悄悄改走其他服务。调用费用取决于你的语音服务账户。

## Mac 环境要求

- Apple Silicon Mac（M 系列），macOS 14 或更新版本；当前实机验证环境为 M4 / 16 GB / macOS 26.2。
- Node.js 22+、pnpm 10、[uv](https://docs.astral.sh/uv/getting-started/installation/)。运行时脚本会用 uv 准备 Python 3.11。
- 首次安装需要联网下载依赖与模型。模型约 2.3 GB，建议至少预留 5 GB 空间。
- Intel Mac、Windows ARM 和 Linux 暂未支持。本项目的 [MLX 依赖要求 Apple Silicon / macOS 14+](https://ml-explore.github.io/mlx/build/html/install.html)。

## Mac 从源码运行

```bash
git clone https://github.com/bushushu2333/macmic.git
cd macmic
pnpm install --frozen-lockfile
pnpm setup:model
pnpm dev
```

`setup:model` 只在首次使用或修复运行时时需要执行。模型与依赖安装在 `~/Library/Application Support/macmic/`，不会进入仓库；模型下载固定到指定 revision。推理时启用离线模式。

首次启动会显示设置面板。等待左下角显示“本地模型已就绪”，在系统设置中允许麦麦使用麦克风和辅助功能。开发模式下，macOS 权限列表可能显示 Electron；安装版显示麦麦。

## Mac 打包安装

```bash
pnpm build:mac
codesign --force --deep --sign - --entitlements entitlements.mac.plist 'dist-local/mac-arm64/麦麦.app'
ditto 'dist-local/mac-arm64/麦麦.app' '/Applications/麦麦.app'
```

先退出正在运行的麦麦，再更新 `/Applications` 中的应用。这里生成的是本机签名的开发构建，没有 Apple Developer ID 公证；不附带 Python 运行时和模型。使用本地模式时，换电脑仍需在目标电脑执行 `pnpm setup:model`；豆包模式无需本地模型。当前发行以源码为主。

首次安装或签名变化后，如自动输入没有生效，请检查“系统设置 → 隐私与安全性 → 辅助功能”中的麦麦权限。失败时文字会保存在输入记录，并尝试复制到剪贴板以便手动粘贴。

## 快捷键

| 操作 | 方式 |
| --- | --- |
| Mac 开始 / 结束录音 | `⌘⇧Space`，或菜单栏的“开始 / 结束录音” |
| Windows 开始 / 结束录音 | 轻按左 / 右 `Alt`，备用 `Ctrl+Shift+Space`，或右键系统托盘图标 |
| 单击右侧 Command | 内置支持，允许输入监控后使用，见 [快捷键说明](docs/SHORTCUTS.md) |
| 取消当前录音 / 识别 / 整理 | `Esc` 或浮条上的叉号 |
| 打开面板 | 菜单栏波形图标 → 打开麦麦 |

右 Command 是单独按下再松开，不是组合键。使用右 Command 复制、粘贴等操作不应触发录音。

## 词库与文字整理

在“词库”中添加标准写法即可，可搜索现有词语，也可按行或用逗号批量添加多个词。上限 150 个，每个词最多 80 字。词库提供识别提示，不保证同音词永远正确，也不会做无条件的全局替换。

在“设置”中填写服务地址、模型名和自己的 API 密钥，然后开启“智能文字整理”。仓库不提供共享密钥、默认账户或代理服务。文字整理可能产生你所选服务的调用费用。

## 数据与隐私

- 词库、设置、转录历史保存在本机：Mac `~/Library/Application Support/macmic/transcriptions.db`；Windows `%APPDATA%\macmic\transcriptions.db`。
- API 密钥目前保存在该本地数据库中，未接入系统凭据库。请勿公开数据库、配置导出或包含密钥的诊断文件。
- 本地模式的临时 WAV 在系统临时目录生成，请求结束后清理；异常强制退出可能留下临时文件。豆包模式通过内存流式发送音频，不写临时 WAV。
- 仅在明确选择豆包并开始录音后连接语音服务。豆包 API 密钥仅在主进程使用，不回传页面。选择豆包会发送录音和词库。
- 开启文字整理后，转录文本及词库会发送到所配置的服务；关闭后无需该服务。
- 没有内置遥测。仓库不包含个人词库、输入历史、音频、模型权重或 API 密钥。

## 开发与验证

```bash
pnpm test
pnpm build:renderer
pnpm check:public
# 安装模型后，用自己的含语音 WAV 做本地集成测试：
node scripts/test-local-asr.cjs /path/to/speech.wav
```

测试也覆盖原生 / F19 重复事件去重、备用快捷键冲突和睡眠后重连。macOS 构建会编译 Swift 监听器并测试轻按、组合键和长按语义。测试涵盖录音取消、等待麦克风时取消、丢弃迟到结果、重复触发保护、文字整理失败回退、词库去重与边界。模型测试检查持久进程复用、并发初始化及无效音频处理。准确率与延迟仍取决于语音、词汇、电脑和可选的整理服务。

主要代码：`src/helpers/asrManager.js`（识别服务选择）、`src/helpers/doubaoAsr.js`（豆包协议与连接）、`assets/pcm-capture-worklet.js`（流式采样）、`src/App.jsx`（界面）、`src/hooks/useVoiceSession.js`（录音流程）、`src/helpers/localAsrManager.js`（模型进程）、`qwen_server.py`（本地推理）。GitHub Actions 在 Linux 和 Windows 运行回归测试，并在 Windows 构建 x64 安装包。另有手动触发的 Windows 模型集成测试，下载公开测试音频检验本地推理；这不替代真实电脑的麦克风、热键和跨应用粘贴体验测试。

## 来源与许可

麦麦基于 [yan5xu/ququ](https://github.com/yan5xu/ququ) 改造，保留上游 [LICENSE](LICENSE) 原文及 [NOTICE](NOTICE) 署名。上游 LICENSE 标题为 Apache 2.0，但文件文本与标准模板存在差异，且原 package.json 写为 MIT；本仓库没有重新解释或替换该许可，具体条款以保留的文件为准。

感谢 [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[mlx-community](https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit)、[MLX](https://github.com/ml-explore/mlx)、[mlx-audio](https://github.com/Blaizzy/mlx-audio)、Electron、React 和 Lucide。模型权重与第三方依赖分别适用各自的许可证。

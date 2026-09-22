# Windows 版 · 麦麦 macmic

Windows 版共用 Mac 版的页面、真实声音波形和录音流程，使用 Windows 原生托盘与窗口控制按钮。关闭窗口后继续后台运行；双击托盘图标打开面板，右键提供录音和退出入口。

## 系统要求

- Windows 10/11 **x64**，本地模型模式建议 16 GB 或更多内存，预留至少 10 GB 磁盘空间；豆包模式无需模型和 Python。
- 模型为 [Qwen3-ASR-1.7B-hf](https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf)，通过原生 Transformers / PyTorch 在本地识别。
- 默认安装 CPU 版，不要求独立显卡。CPU 识别速度取决于电脑，长录音等待时间会更长；尚未提供统一性能承诺。
- 首次安装联网下载依赖与模型；推理强制离线。Windows ARM 暂不支持。

## 安装

从 [Releases](https://github.com/bushushu2333/macmic/releases) 下载最新版 Windows x64 安装包。更新会保留 `%APPDATA%\macmic` 下的词库和历史。

### 使用豆包语音

1. 安装并打开麦麦，在“设置 → 语音识别”选择豆包。
2. 填写自己的 App ID、Access Key 和 Resource ID，保存设置。默认资源 ID 为 `volc.seedasr.sauc.duration`。
3. 允许 Windows 设置中的麦克风及“让桌面应用访问麦克风”，在输入框轻按左 `Alt` 或右 `Alt` 开始听写。

此模式会把录音和专有词库发送到火山引擎，可能产生账户调用费用。无需安装本地模型，启动时也不会加载它。配置状态不代表网络或额度已通过检查；连接失败会在录音浮条中显示。

### 使用本地模型

1. 从 [Releases](https://github.com/bushushu2333/macmic/releases) 下载 `macmic-0.3.1-windows-x64-setup.exe` 并安装。安装包未使用商业代码签名证书，Windows 可能提示未知发布者；只使用本仓库发布的文件并核对 SHA-256。
2. 同页下载 `macmic-windows-model-setup.zip`，解压到一个文件夹。
3. 在 PowerShell 安装 uv，然后**新开一个 PowerShell 窗口**，让 PATH 生效：

   ```powershell
   winget install --id astral-sh.uv -e
   ```

4. 进入刚才解压的文件夹，执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Setup-Model.ps1
   ```

   该参数只对这次脚本进程生效，不更改系统执行策略。脚本创建 Python 3.11 环境、安装锁定的依赖并下载固定 revision 模型。中途断网可重新运行；不要同时录音或运行两个安装脚本。
5. 打开麦麦，在“设置”选择本地识别并点“重启模型”，等待“本地模型已就绪”。允许 Windows 设置中的麦克风及“让桌面应用访问麦克风”。

Python、模型与数据保存在 `%APPDATA%\macmic\`。更换安装路径不会删除词库和历史。安装目录的 `resources\setup\` 也包含相同准备脚本。

## 使用

| 操作 | 方式 |
| --- | --- |
| 开始 / 结束 | 轻按左 / 右 `Alt`，备用 `Ctrl + Shift + Space`，或右键托盘图标 |
| 取消录音 / 识别 / 整理 | `Esc` 或浮条叉号 |
| 打开面板 | 双击托盘图标 |
| 退出程序 | 右键托盘 → 退出麦麦 |
| 自动输入失败 | 输入记录中复制，再按 `Ctrl+V` |

在目标输入框放好光标，再触发快捷键。浮条不会主动夺取键盘焦点；结束后使用 Ctrl+V 将结果输入目标应用。普通权限应用无法可靠地给管理员权限窗口输入；这种情况请手动复制粘贴。快捷键冲突时可使用托盘入口。

词库与可选的文字整理功能见 [README](../README.md#词库与文字整理)。新安装默认关闭在线文字整理。

## 可选 NVIDIA GPU

代码会自动检测 `torch.cuda.is_available()`；默认 CPU 安装不包含 CUDA。熟悉 Python 环境的用户可按照 [PyTorch 官方安装选择器](https://pytorch.org/get-started/locally/) 为 `%APPDATA%\macmic\asr-runtime\Scripts\python.exe` 安装匹配驱动的 CUDA wheel。不要把包装到系统 Python 中。GPU 使用 FP16；CUDA 硬件性能尚待实机验证。重新运行默认安装脚本会恢复锁定的 CPU 环境。

## 从源码开发 / 构建

安装 Node.js 22+、pnpm 10 和 uv，然后在 Windows 执行：

```powershell
git clone https://github.com/bushushu2333/macmic.git
cd macmic
pnpm install --frozen-lockfile
pnpm setup:model:win
pnpm dev
# 构建安装程序：
pnpm build:win
```

安装包输出到 `dist\`。必须在 Windows 构建，确保 SQLite 的 Electron 原生模块匹配操作系统。GitHub Actions 提供相同的构建流程。

Windows 版会随同一仓库发布更新。自动化构建和公开音频模型测试的结果可在 Actions 查看；真实麦克风、不同键盘以及各应用的粘贴兼容性仍需 Windows 实机体验反馈。

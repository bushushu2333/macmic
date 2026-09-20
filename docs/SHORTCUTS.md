# 右 Command 单击

麦麦本身支持 `⌘⇧Space` 和菜单栏录音，不需要额外软件。

如果你偏好单击右侧 Command，可使用 [Hammerspoon](https://www.hammerspoon.org/) 将这个按键映射为 F19：

1. 安装 Hammerspoon，在 macOS 中授予它辅助功能权限。
2. 把 `examples/macmic-hotkey.lua` 复制到 `~/.hammerspoon/macmic-hotkey.lua`。
3. 在现有 `~/.hammerspoon/init.lua` 中加入下面一行，保留已有配置：

```lua
require('macmic-hotkey')
```

4. 在 Hammerspoon 菜单里选择 **Reload Config**。
5. 若 macOS 询问是否允许 Hammerspoon 控制 System Events，允许该操作以发送 F19。

不要同时启用多份映射相同按键的配置。已经有右 Command → F19 的映射时无需再添加。示例只处理单独的右 Command，组合快捷键不触发；系统启用 Secure Input 时，全局按键监听可能不可用。

卸载映射时移除 `require('macmic-hotkey')`，再重新加载 Hammerspoon 配置。

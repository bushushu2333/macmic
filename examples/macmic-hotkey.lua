-- macmic: right Command alone -> F19. Does not replace existing Hammerspoon config.
local M = { pressed = false, alone = false, tasks = {} }
local function trigger()
  local task
  task = hs.task.new('/usr/bin/osascript', function()
    M.tasks[task] = nil
  end, { '-e', 'tell application "System Events" to key code 80' })
  if task then M.tasks[task] = true; task:start() end
end
M.tap = hs.eventtap.new({ hs.eventtap.event.types.flagsChanged, hs.eventtap.event.types.keyDown }, function(event)
  local flags = event:getFlags()
  if event:getType() == hs.eventtap.event.types.flagsChanged and event:getKeyCode() == 54 then
    if flags.cmd and not M.pressed then
      M.pressed = true
      M.alone = not (flags.alt or flags.ctrl or flags.shift or flags.fn)
    elseif not flags.cmd and M.pressed then
      M.pressed = false
      if M.alone then hs.timer.doAfter(0.01, trigger) end
      M.alone = false
    end
  elseif M.pressed then
    M.alone = false
  end
  return false
end)
M.tap:start()
return M

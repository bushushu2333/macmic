const builder = require('electron-builder');
const config = JSON.parse(JSON.stringify(require('../package.json').build));
config.directories.output = process.env.MACMIC_BUILD_OUTPUT || 'dist-local';
config.mac.identity = null;
config.mac.notarize = false;
config.npmRebuild = false;
config.mac.extendInfo = {
  NSMicrophoneUsageDescription: '麦麦需要麦克风，将你的语音在本机转换成文字。',
  NSAppleEventsUsageDescription: '麦麦需要将识别结果输入到当前应用。'
};
builder.build({ targets: builder.Platform.MAC.createTarget(['dir'], builder.Arch.arm64), config })
  .catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });

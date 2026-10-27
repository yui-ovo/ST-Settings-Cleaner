# 酒馆设置清理 0.1.0

独立的 SillyTavern 前端扩展。打开扩展面板 → **酒馆设置清理** → **打开设置清理**。

## 能做什么

- 按 UTF-8 JSON 大小排列插件设置，搜索设置名或关联插件名。
- 内置设置、检测到关联的已安装/停用插件设置锁定保留。
- 识别不出的项目显示“归属不明”，不会自动认定为垃圾或自动勾选。
- 若以前扫描时记录过关联插件，当前安装列表找不到它，则显示“疑似卸载”。第一次安装无法可靠识别所有历史残留。
- 勾选 → 查看清单 → 下载备份 → 确认文件已保存 → 清理。执行前重新检查插件和数据，保存后向服务器核验。
- 导入本插件的备份，勾选恢复缺失项目；已有不同内容时跳过，不覆盖新设置。
- 手机、电脑均可使用，颜色跟随酒馆主题。仅手动打开/重新扫描时工作，无后台扫描和自动清理。

## 安装

在酒馆中打开 **扩展 → 安装扩展**，粘贴：

```text
https://github.com/yui-ovo/ST-Settings-Cleaner
```

分支/标签留空，安装后刷新酒馆。在扩展面板找到 **酒馆设置清理** 即可打开。

### 手动安装

本地安装包：解压得到 `ST-Settings-Cleaner` 文件夹，将整个文件夹放到酒馆的
`data/<你的账户>/extensions/` 内（与其他用户扩展并列），刷新酒馆。
也可由服务器管理员放到 `public/scripts/extensions/third-party/` 作为全局扩展。
不要把 ZIP 填进“安装扩展”的 Git URL 栏；那个入口需要 Git 仓库地址。

仅操作自己当前账户的 `extension_settings`。不修改酒馆程序，不删除整个 settings.json。
不是酒馆助手脚本，不需要酒馆助手或预设工坊。

## 清理范围和限制

只清理设置的顶层项目，不递归猜测哪些字段“没用”。一项内可能包含收藏、脚本、历史记录或插件其他功能数据；删除该项会一起删除这些内容。
聊天、角色卡、预设文件、世界书文件、浏览器缓存和插件自身独立数据库不在清理范围内。

插件归属分析只读取本酒馆服务器上的清单与代码文本，不执行扫描到的脚本、不向外部服务器上传设置。
扫描每个插件最多 12 个入口/相对引用脚本，总计最多 4 MB，单文件最多 2 MB，并发最多 3 个插件。
动态构造设置名、压缩后的别名、超出限额的源码可能无法识别。代码引用也不等于独占归属，所以“疑似卸载”仍需用户确认。
关联记录按酒馆账户放在当前浏览器 localStorage；只含设置名与插件目录名，不含设置值或备份。更换设备不会带走这份识别历史。

备份是插件设置完整快照及此次清理的项目清单，下载到用户设备，不塞回 settings。
它可能包含插件私有信息，请自己保管。恢复仅支持本工具备份、同名酒馆账户及清单内缺失项目；不提供强制覆盖恢复。
操作时请避免另一酒馆标签页同时修改同一账户设置；酒馆保存接口本身不提供跨标签页事务锁。
保存失败会尝试恢复修改前的数据并核验。网络中断等情况下无法确认服务器状态，会明确提示保留备份、重新连接后核对，不会显示成功。

界面占用为紧凑 JSON 的 UTF-8 大小估算，包含属性名，非磁盘 settings.json 文件大小；清理不会保证解决卡顿。
使用酒馆的 `getContext().extensionSettings`、`saveSettings()`、扩展发现及设置读取接口。接口缺失/账户无法确认时停止写入。
代码参考官方 SillyTavern release 接口；测试使用模拟酒馆接口，尚未做真实用户数据或手机硬件验证。

## 开发验证

无需构建、无需运行依赖。`npm run check` 与 `npm test`。
浏览器集成测试：安装 Playwright 后运行 `npm run test:browser`；也可通过 `PLAYWRIGHT_MODULE` 指定已安装的模块路径。
`BROWSER_ENGINE=webkit` 使用 WebKit，默认 Chromium；`BROWSER_CHANNEL=msedge` 可使用本机 Edge。

官方接口参考：
- https://docs.sillytavern.app/for-contributors/writing-extensions/#persistent-settings
- https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions.js
- https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js

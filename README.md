# 情报通 CLI

通过专用 Google Chrome 会话观察和操作情报通页面。提供页面快照、元素操作、文件传输和页面盘点，供终端脚本及后续工具集成使用。MCP 尚未实现。

## 安装

需要 Node.js 22.13+、npm 和 Google Chrome。每位使用者使用自己的情报通账号和页面权限。

```sh
git clone https://github.com/JFFTokki/nint-cli.git
cd nint-cli
npm ci
npm install -g .
nint --version
```

也可在仓库中用 `node bin/nint.mjs` 代替 `nint`。本包尚未发布到 npm 公共仓库。

## 启动与登录

在固定工作目录中执行：

```sh
nint init
nint login
nint ui snapshot --json
```

`login` 启动或复用常驻专用 Chrome，请在窗口中手动完成登录及验证。命令返回表示浏览器已打开，不表示账号登录已成功；用快照和当前页面核对状态。

```sh
nint session start
nint session status
nint session stop
```

服务保持浏览器开启，让多个 CLI 进程共享同一会话。`stop` 只关闭本服务拥有的专用浏览器。程序使用独立 `data/browser-profile`，不连接日常浏览器、不复制其他浏览器的 Cookie。网站是否跨重启保留登录由平台决定。同一专用目录一次只能有一个服务使用。

需要与日常 Chrome 在 macOS 应用图标和名称上也分开时，可安装官方 Chrome for Testing，并在本地配置中设置 `browserExecutable` 为其可执行文件路径（相对路径按配置文件目录解析）。也可用 `--browser-executable` 临时指定。此选项只改变浏览器程序，仍使用同一专用 `data/browser-profile`；不会连接普通 Chrome。未设置时沿用已安装的 Google Chrome。

## 通用页面操作

先观察页面，再使用返回的真实 `snapshotId` 与元素 `ref` 操作。以下引用仅为示意，需要替换为当前快照中的值。

```sh
nint ui open --url "https://art.nint.com/"
nint ui snapshot --json
nint ui fill --snapshot s-当前快照 --ref e1 --value "输入内容"
nint ui click --snapshot s-新快照 --ref e2
nint ui select --snapshot s-新快照 --ref e3 --value "选项value"
nint ui check --snapshot s-新快照 --ref e4
nint ui uncheck --snapshot s-新快照 --ref e4
nint ui wait --text "目标文字"
nint ui read --limit 10000
nint ui tables --limit 5000 --json
```

`ui tables` 读取各 frame 普通 DOM 中已加载的 HTML 表格和 ARIA grid，保留合并单元格及行列可见性标记。`--limit` 是每张表的行数上限，超出时返回截断标记；不会自动翻页或加载虚拟列表中的其他行。

每次动作后返回新快照。旧快照、重绘或删除的节点会被拒绝；多个客户端按服务收到命令的顺序串行执行。快照只包含已经加载的 DOM、开放 Shadow DOM 和 frame；需要打开的菜单与弹窗应先操作再观察。密码和识别为认证信息的输入值会遮蔽。

其他操作：

```sh
nint ui tabs
nint ui tab --tab t2
nint ui close-tab --tab t3
nint ui back
nint ui forward
nint ui reload
nint ui scroll --y -200
nint ui hover --snapshot s-当前快照 --ref e1
nint ui scroll --snapshot s-当前快照 --ref e1 --y 600
nint ui press --snapshot s-当前快照 --ref e1 --key Enter
nint ui drag --snapshot s-当前快照 --ref e1 --target e2
nint ui upload --snapshot s-当前快照 --ref e1 --file ./example.txt
nint ui download --snapshot s-当前快照 --ref e1 --output ./output
nint ui screenshot --output ./output
```

`ui download` 等待浏览器下载事件，保存原始文件并返回 `browser_download_only`；它不解析文件的业务内容。点击完成不代表页面业务已成功，需要继续读取结果核对。拖拽、Canvas 和自定义组件能否完成具体操作，应逐组件验证。

页面导航限制在 nint.com 及其子域，不提供任意 JavaScript 执行入口。服务仅监听 `127.0.0.1` 的临时端口，使用专用数据目录中的私有令牌认证，拒绝网页跨域请求。

## 页面盘点

在目标页面观察或展开组件后执行：

```sh
nint inventory capture --label "示例页面" --output ./output
nint inventory report --output ./output
```

`capture` 保存当前页面快照、候选交互和本会话已执行动作；`report` 汇总同一输出目录中的记录，生成 `inventory/catalog.json` 和 `catalog.md`。已观察页面与仅发现的链接分别记录，不自动遍历或执行全部候选动作。盘点和截图可能包含账号内信息，应留在本机。

## 本地配置

配置示例见 [nint.config.example.json](nint.config.example.json)。`nint init` 创建的 `nint.config.json` 已被 Git 忽略。

| 字段 | 用途 |
|---|---|
| `output` | 下载、截图和盘点输出目录，默认 `./output` |
| `dataDir` | 专用服务数据目录，默认 `./data` |
| `startUrl` | 启动页面，默认情报通首页 |
| `browserExecutable` | 可选的专用 Chrome 可执行文件路径；默认使用已安装的 Google Chrome |
| `actionTimeout` | 页面操作等待时间，默认 60000 毫秒 |
| `downloadTimeout` | 浏览器下载等待时间，默认 60000 毫秒 |
| `local` | 个人本地备注，默认空对象；不进入运行选项、服务请求或网页操作 |

个人类目和命名偏好可记录在本机配置的 `local` 中，程序不据此生成或执行任务。仓库不提供固定类目、日期、指标或归档默认值。

配置文件中的相对路径相对配置文件，命令行路径相对当前工作目录。使用其他终端目录时，传入同一个配置文件的绝对路径：

```sh
nint ui snapshot --config /path/to/nint.config.json --json
```

参数用 `--output`、`--data-dir`、`--start-url`、`--browser-executable`、`--action-timeout`、`--download-timeout` 覆盖相应配置。路径含空格时加引号。`data/`、`output/`、个人配置、日志和本地安装包均不纳入 Git；不要将这些目录添加到分发文件。

## 开发与验证

```sh
npm ci
npm test
```

测试使用明确标记的本地 fixture、请求拦截和临时专用 profile，覆盖 CLI 配置隔离、服务认证、跨进程操作、快照失效、通用控件、文件传输、盘点与停止。不包含真实账号的验收摘要，不宣称所有页面或所有系统均已验证。

退出码：`0` 成功，`1` 运行错误，`2` 参数或配置错误，`130` 用户中断。升级前先用旧版本执行 `nint session stop`，再安装并启动新服务。

已有安装更新时，在工作目录先运行 `nint session stop`，然后在源码目录执行 `git pull --ff-only`、`npm ci`、`npm install -g .`。最后返回原工作目录重新启动服务；用 `nint --version` 核对版本。通过 ZIP 安装时，重新下载并解压源码后执行相同安装命令。

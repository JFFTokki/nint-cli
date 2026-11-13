# 运行环境

需要 Node.js 22.13+、Python 3（含 openpyxl）及已安装依赖的情报通 CLI。逐店队列使用 Unix 文件锁，适用于 macOS/Linux。先核对 CLI 文件和本地配置，不扫描或复制浏览器登录资料。

从独立 CLI 仓库运行时，设置以下变量为本次已验证的绝对路径：

```sh
export NINT_PROJECT='/absolute/path/to/nint-cli'
export NINT_CONFIG="$NINT_PROJECT/nint.config.json"
export NINT_OUTPUT='/absolute/output/new-run'
export NINT_NODE="$(command -v node)"
export NINT_PYTHON="$(command -v python3)"
export NINT_SKILL='/absolute/path/to/nint-shop-download'
```

`NINT_PROJECT` 也兼容包含 `packages/nint-cli` 的工作台；此时 `NINT_CONFIG` 指向该子目录的配置。脚本优先检查 `bin/nint.mjs`，再检查 `packages/nint-cli/bin/nint.mjs`，未显式设置配置路径时使用 CLI 所在目录的 `nint.config.json`。复制安装 skill 后仍须保留 CLI 仓库并指向它。

Codex 桌面环境可通过 `load_workspace_dependencies` 查找捆绑的 Node、Python 和库。月榜生成脚本还依赖捆绑的 `@oai/artifact-tool`（XLSX 导出和预览）：设置 `NINT_NODE_MODULES` 为工具返回的 Node.js packages 路径，并将 `NINT_NODE`、`NINT_PYTHON` 设置为返回的可执行文件。逐店下载不需要 artifact-tool。没有此捆绑依赖的环境可使用逐店模式；不要把缺依赖的月榜生成标为已完成。不要修改捆绑依赖目录。

配置文件中的 `dataDir`、`browserExecutable` 决定专用会话。保持既有配置，不另建日常 Chrome 连接；脚本不会迁移或安装 CLI。首次配置遵循仓库 README 的 `nint init` 和 `nint login`。

独立仓库示例（工作台布局将 CLI 路径改为 `$NINT_PROJECT/packages/nint-cli/bin/nint.mjs`）：

```sh
"$NINT_NODE" "$NINT_PROJECT/bin/nint.mjs" session status --config "$NINT_CONFIG" --json
# 未运行时启动；登录失效时在该专用窗口内登录。
"$NINT_NODE" "$NINT_PROJECT/bin/nint.mjs" session start --config "$NINT_CONFIG" --json
"$NINT_NODE" "$NINT_SKILL/scripts/run-cli.mjs" snapshot
```

`run-cli.mjs` 封装 CLI，并为操作加 2—5 秒随机等待、保存输出目录内的动作证据；传入 CLI 支持的 JSON 参数。每次从真实快照取 `snapshotId/ref`；参数使用结构化调用或正确 shell 引用，不把店名拼成可执行 shell 代码。不得编造元素 ref、店铺 ID 或未观察到的详情 URL。耗时下载时保持进度反馈，等待文件完成，不在另一标签开始下家。

新增独立运行目录防止覆盖。`download-month.mjs` 检测到目标目录已有队列会退出，续跑商品阶段直接使用该队列。异常中断遗留 `.workflow.lock` 时先确认无脚本及下载仍在运行，再删除锁恢复；不能直接启动第二个浏览器工作流。

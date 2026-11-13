# 逐店商品表：Agent 执行 CLI，队列控制顺序

设置 `NINT_QUEUE` 为本次 `店铺下载队列.json` 的绝对路径。根据用户确认的范围使用月榜队列或固定清单队列；不要把不同名单的历史下载数量当作本轮完成数量。固定清单不要求100家；已有文件必须逐店核对并验证哈希。

## 取下一家

```sh
"$NINT_PYTHON" "$NINT_SKILL/scripts/shop-queue.py" next --queue "$NINT_QUEUE"
```

该操作核对来源表哈希和队列内容，并检查此前完成文件的存在、大小、修改时间等；元数据改变才重算哈希，避免每店反复全量读取所有历史大文件。中断续跑前先执行同参数的 `audit`，对已完成文件做一次完整哈希复核。`complete:true` 才表示全队列完成；否则只处理返回的这一家。`downloading` 表示上次可能仍在下载：先核实专用浏览器下载状态和当前店铺目录，已有完整文件则验收，仍进行中则等待。无法确认旧下载结束时不要再次开始或搜下一家。

## 查找、确认身份

1. CLI点击“店铺分析”，进入“店铺列表”。观察快照及表格，使用“请输入掌柜名称”搜索框填入队列 `searchName`，点击搜索。
2. 等待结果稳定，核对掌柜名、店铺名以及该行“查看详情”链接的 `sid`。榜单 `shopUrl` 是淘宝掌柜链接，不能把其中的ID直接当作情报通 `sid`。先匹配掌柜名和店铺名，再记录该行真实详情链接及 `sid`，避免旗舰店/奥莱店/专卖店混淆；不只选第一个模糊命中。
3. 无结果、多个疑似结果或ID不同：停在本店记录问题，不能自行关注店铺、开通权限或用猜测URL绕过。
4. 当前行名称唯一匹配并取得真实详情链接后建立本店进行中状态，再点“查看详情”。默认不是“宝贝列表”时点击该页签，确认当前 `sid` 与选择店铺一致。

```sh
"$NINT_PYTHON" "$NINT_SKILL/scripts/shop-queue.py" begin --queue "$NINT_QUEUE" --rank RANK --sid OBSERVED_SID --detail-url OBSERVED_DETAIL_URL --observed-search-name OBSERVED_SEARCH_NAME --observed-shop-name OBSERVED_SHOP_NAME
```

只有用户明确要求商品表期间、且UI可设置并已读回时才加 `--expected-period 'YYYY-MM-DD ~ YYYY-MM-DD'`。不要把月榜月份盲目传给此参数；未指定时验收记录实际商品期间，不虚构历史商品月。

## 下载、验收、再继续

在宝贝列表核对过滤条件，保持用户指定范围。不要把关注标签下拉框当作商品类目筛选。点击“下载”展开菜单后重新取快照，对“带图(前3000)”调用 `ui download`，`download-timeout` 可为300000毫秒。保存到本次运行的 `商品表/排名_掌柜名/`；下载结束后以安全处理过的店名命名 `.xlsx`，已有文件先核对，不覆盖历史件。

使用 `run-cli.mjs download` 的结构化JSON参数：`snapshot`、`ref`、`output`、`download-timeout`。不能先用普通click触发下载、事后才等待下载事件；不能因下载耗时提前搜索下一家。

```sh
"$NINT_PYTHON" "$NINT_SKILL/scripts/shop-queue.py" accept --queue "$NINT_QUEUE" --rank RANK --file '/absolute/shop.xlsx'
```

验收检查ZIP、`QBT`/`下载条件`、模块、店铺ID、实际期间、商品名称/链接、1—3000行、每行图片锚点及非空嵌入媒体。通过后原子写入 `verified`、SHA256、行数、图片数、实际期间和 `limitReached`。只有此时才能取下一家。图片数与行数不符先调查，不能用改扩展名或生成空表伪装成功。

明确失败且确认原下载已经结束后：

```sh
"$NINT_PYTHON" "$NINT_SKILL/scripts/shop-queue.py" fail --queue "$NINT_QUEUE" --rank RANK --reason '实际失败原因'
```

`fail` 不跳过本店；下次 `next` 仍返回同一家。完成失败原因处理后可再次 `begin`。当前阶段一次恢复后仍失败就暂停并报告。已完成文件改变/消失会阻止继续，不自动覆盖修复。

视觉检查首份、格式异常文件和最终代表性文件，确认表格和图片可读。达到3000行标明可能截断。最终报告成功/失败/剩余数量与文件目录；不能将有待处理记录的队列称为完成。

用户明确授权无结果店铺记缺失并继续时，可用 `skip --reason 实际原因 --authorization 用户授权记录`。缺失与成功分别计数；空白页面、加载失败或身份不一致不能当作无结果跳过。

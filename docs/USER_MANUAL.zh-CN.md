# FinTrack 用户手册

本手册说明 FinTrack 部署完成后的日常使用方式。

FinTrack 是一个私有的个人财务应用。它不是银行、券商、税务工具，也不是权威会计系统。把导入数据用于财务决策之前，请始终人工复核。

## 1. 首次登录

在浏览器中打开应用：

```text
http://<your-server>:3000
```

如果设置了 `FINTRACK_PASSWORD`，浏览器会提示输入 Basic Auth 凭据。

默认用户名：

```text
fintrack
```

密码使用你在 Docker compose 环境变量中配置的值。

如果应用打开时没有密码提示，请先停止容器，并在网络环境中使用前设置 `FINTRACK_PASSWORD`。

## 2. 初始设置

打开 Settings 页面。

配置：

- SimpleFIN access URL，如果你需要自动同步。
- 每日同步时间。
- 可选的 Gemini API key，用于 AI 分类。
- 可选的 Claude API key，作为备用分类器。

Settings 页面会把已配置的密钥保存到本地 SQLite 数据库中。请保护并备份该数据库。

## 3. 同步交易

在顶部导航栏点击 Sync。

FinTrack 会：

1. 从 SimpleFIN 获取账户和交易。
2. Upsert 账户。
3. Upsert 交易。
4. 更新余额。
5. 创建净资产快照。
6. 让新交易进入待复核状态。

如果同步失败：

- 确认 SimpleFIN access URL 有效。
- 确认应用可以访问网络。
- 检查 SimpleFIN bridge 会话是否需要刷新。
- 查看容器日志。

## 4. Home 仪表盘

Home 页面汇总：

- 账户余额
- 净资产
- 支出趋势
- 最近交易
- 复核进度

同步之后，可以把它作为快速健康检查入口。

## 5. Accounts 账户页

Accounts 页面显示已同步的金融账户。

常见操作：

- 复核账户名称。
- 检查当前余额。
- 查看最近同步状态。
- 确认账户是否仍然活跃，或是否已经过期。

如果账户信息看起来不正确，优先在数据源修正，然后重新同步。

## 6. Transactions 交易页

Transactions 页面是主要的账目复核界面。

你可以：

- 按日期范围筛选。
- 按账户筛选。
- 按分类筛选。
- 搜索交易描述。
- 打开交易详情页。
- 修改分类。
- 标记交易已复核。
- 取消不应导出的交易。

推荐流程：

1. 同步。
2. 复核最新交易。
3. 给所有未分类交易补上分类。
4. 确认转账。
5. 检查报表。

## 7. Review Queue 复核队列

Review 页面聚焦仍需处理的交易。

交易进入 Review 的常见原因：

- 缺少分类。
- 被分配到了 review 分类。
- 交易仍为 pending。
- 可能是转账。
- 分类置信度较低。

只有当你明确知道交易归属后，才应该让它离开 Review。

## 8. Categories 分类

分类用于报表和导出。

FinTrack 支持：

- 支出分类
- 收入分类
- 权益分类
- 转账分类
- 可选的 Beancount 账户名称

示例：

```text
Expenses:Food:Groceries
Expenses:Food:Restaurants
Income:Salary
Transfer:Internal
Transfer:CreditCardPayment
```

如果 Beancount 以只读方式挂载，FinTrack 可以读取已打开的 Beancount accounts，并在分类选择器中显示它们。

## 9. Rules 规则

规则会根据文本模式给交易分类。

适合给稳定、重复出现的交易描述创建规则，例如：

- 工资
- 利息
- 信用卡还款
- 常见订阅
- 杂货
- 水电等账单

除非有意这么做，否则不要创建只匹配单笔交易的过度具体规则。

规则优先级决定多条规则同时匹配时哪条胜出。数字越大，优先级越高。

推荐流程：

1. 先手动给交易分类。
2. 只有当类似交易会重复出现时，才创建规则。
3. 应用规则。
4. 导出前复核结果。

## 10. AI Classification AI 分类

AI 分类是可选功能。

配置后，FinTrack 可以使用 Gemini 或 Claude 推荐分类。Gemini 可用时会优先尝试，Claude 配置后作为备用。

AI 输出应该人工复核。不要把它当成权威结果。

推荐用法：

- 用 AI 加快复核。
- 重要分类保持人工确认。
- 确认重复模式后，为 recurring transactions 添加确定性规则。

## 11. Transfers 转账

Transfers 页面帮助识别账户之间的资金移动。

常见转账类型：

- 银行账户之间转账
- 信用卡还款
- 钱包转账
- 投资转账

当转账两边都存在并成功匹配时，更安全。

如果其中一边在 FinTrack 之外，并且你的 Beancount 工作流支持，可以选择合适的外部资产或负债账户。

示例：

```text
Transfer:Internal
Transfer:CreditCardPayment
Transfer:Wallet
Assets:Wallet:Example
```

Beancount handoff 之前请仔细复核转账。错误的转账匹配可能导致重复支出或余额错误。

## 12. Reports 报表

Reports 页面汇总财务活动。

常见视图：

- 按分类查看支出
- 按分类查看收入
- 净资产变化
- 账户级活动

报表的准确性取决于已复核的交易。如果报表看起来不对，请回到 Transactions 和 Review 检查。

## 13. 导入和导出

Import 页面可以预览交易文件，并先进入 staging review，确认后再 promote。

应用也提供导出功能：

- Transactions
- Accounts
- Net worth
- Backups
- Beancount drafts

请把导出文件视为敏感财务数据。

## 14. Beancount Handoff 概览

FinTrack 可以把已复核的月度活动交接给单独的 Beancount 工作流。

重要边界是：

```text
FinTrack writes handoff files.
Beancount worker validates and promotes them.
Fava reads only a checked Beancount artifact.
```

FinTrack 不应该直接写入 `main.bean` 或 `book/`。它会把 handoff package 写入共享目录。Beancount worker 读取该 package，运行校验，等待 FinTrack 中的批准决定，然后把已复核分录提升到 Beancount ledger。

### 必需挂载

Docker 中，FinTrack 的典型挂载如下：

```text
/app/data     read-write  FinTrack SQLite database
/beancount    read-only   Beancount checkout
/handoff      read-write  Shared handoff directory
```

FinTrack 容器内的环境变量：

```text
DB_PATH=/app/data/fintrack.db
BEANCOUNT_ROOT=/beancount
FINTRACK_HANDOFF_ROOT=/handoff
```

Beancount worker 必须挂载同一个 handoff 目录：

```text
/handoff      read-write  Same shared handoff directory
```

Beancount worker 还需要对自己的 Beancount checkout 有写权限，因为它负责把内容提升到 `book/`，并可选更新 `main.bean` include。

Fava 不应该挂载 `/handoff`、FinTrack data、raw files 或可写的 Beancount repo checkout。Fava 应该只读取已校验的 artifact。

FinTrack Docker image 以 UID/GID `1001` 运行。宿主机 data 和 handoff 目录必须对该用户可写，或通过等效 NAS ACL 授权。挂载到 FinTrack 的 Beancount checkout 应该是只读的。

### Handoff 目录结构

对于期间 `2026-05`，FinTrack 会写入：

```text
/handoff/2026-05/fintrack/
  manifest.json
  2026-05.bean
  2026-05-transactions.bean
  2026-05-balances.bean
```

Beancount worker 后续可能写入：

```text
/handoff/2026-05/fintrack/status.json
```

FinTrack 会写入批准决定：

```text
/handoff/2026-05/fintrack/decision.json
```

### 状态流

预期流程：

```text
No handoff
  -> FinTrack writes manifest and drafts
  -> Beancount worker consumes draft
  -> ready_for_approval
  -> FinTrack approve or reject
  -> Beancount worker applies decision
  -> merged, rejected, or failed
```

常见状态含义：

| 状态 | 含义 |
| --- | --- |
| No status | FinTrack 已写入文件，但 worker 尚未消费。 |
| `ready_for_approval` | Worker 已校验 draft，正在等待 approve/reject 决定。 |
| `rejected` | 用户从 FinTrack 拒绝了 handoff。 |
| `failed` | Worker 无法消费或应用 handoff。重试前请阅读 worker error。 |
| `merged` | Worker 已将 handoff 提升到 Beancount，且校验通过。 |

`merged` 不一定表示已经创建 Git commit，也不一定表示已经发布 Fava artifact。

## 15. Beancount Preflight

准备月度导出时，打开 Beancount 页面。

选择月份并刷新。

Preflight checks 可能报告：

- 缺失分类或 review 分类
- 未匹配转账
- 可能重复的已有 postings
- 未打开的账户
- Balance assertion 问题

写入 handoff 之前请先修复 blockers。

### Preflight blockers

常见 blockers：

- 交易仍使用 review category。
- 转账尚未匹配或显式处理。
- 交易似乎与已有 Beancount posting 重复。
- Beancount account 在交易日期尚未打开。
- Draft 无法安全渲染。

正确修复通常在 FinTrack 中完成：

- 给交易分类，或取消交易。
- 确认、合并或忽略转账。
- 选择有效的 Beancount account。
- 复核重复交易，并在导出前取消真正的重复项。

## 16. 写入 Beancount Handoff

Preflight 通过后，点击 Write handoff。

FinTrack 会写入文件到：

```text
FINTRACK_HANDOFF_ROOT/YYYY-MM/fintrack/
```

FinTrack 不会写入 Beancount repository。

写入前，FinTrack 会先运行外部 Beancount validation。默认命令是 `bean-check`。如果 validator 存在且返回失败，handoff 不会写入，也不会创建 export run。若环境中没有安装 validator，默认会记录为 unavailable 并继续；可以设置 `FINTRACK_BEANCOUNT_VALIDATION=required` 让缺失 validator 也阻止导出。

写入后，UI 会显示 handoff path 和文件列表。此时 Beancount worker 不一定已经处理这些文件。

如果该 handoff 之前失败或被拒绝，再次写入可能会替换该期间已知的 handoff 文件。FinTrack 不应该覆盖已经 merged 的 handoff。

## 17. 运行 Beancount Worker

Beancount worker 是单独进程。典型命令：

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

Worker 扫描：

```text
HANDOFF_ROOT/*/fintrack/manifest.json
```

对于新的 handoff，worker 会：

1. 读取 `manifest.json`。
2. 把已复核 draft 复制到 Beancount staging。
3. 运行 import review checks。
4. 写入 `status.json`。
5. 停在 `ready_for_approval`。

Worker 报告 `ready_for_approval` 后，回到 FinTrack 并刷新 Beancount 页面。

## 18. 批准 Handoff

Worker 状态为 `ready_for_approval` 时，复核：

- Manifest。
- Draft。
- 交易数量。
- 转账数量。
- 所有 warnings。
- 目标月份。

如果 draft 正确，点击 Approve。

FinTrack 会写入：

```text
decision.json
```

Decision 写入后，worker 必须再次运行。

下一次运行时，worker 会：

1. 读取 `decision.json`。
2. 验证 handoff 仍然处于 ready for approval。
3. 重新运行 review checks。
4. 把已复核 draft 提升到 Beancount。
5. 运行 Beancount validation。
6. 写入最终状态。

如果校验通过，状态变为 `merged`。

## 19. `merged` 之后

当 FinTrack 显示 handoff 已成功写入 Beancount 并通过检查时，说明 Beancount ledger 已由 worker 更新。

生产环境 Beancount/Fava 工作流通常还会有额外步骤：

```text
Review Beancount git diff
  -> run ledger check
  -> git commit
  -> build Fava artifact
  -> validate artifact
  -> publish artifact
  -> reload Fava
```

这些步骤应该属于 Beancount deployment workflow，而不是 FinTrack。

`merged` 后建议 operator 检查：

```bash
git status --short
git diff -- main.bean book/
make ledger-check
```

然后按你的 Beancount/Fava 流程提交和发布。

## 20. 拒绝 Handoff

以下情况应拒绝 handoff：

- Draft 看起来不正确。
- 分类错误。
- 转账错误。
- 期间错误。
- Worker 报告需要复核的 warnings。
- 输出不应该被提升。

拒绝后：

1. 在 FinTrack 中修复根因。
2. 写入新的 handoff。
3. 再次运行 Beancount worker。

## 21. 失败的 Handoffs

Failed handoff 通常表示 Beancount worker 拒绝了 draft，或 validation 失败。

推荐恢复流程：

1. 在 Beancount 页面阅读 worker error。
2. 检查 `status.json`。
3. 检查 Beancount worker logs。
4. 修复根因。
5. 从 FinTrack 写入新的 handoff。
6. 再次运行 worker。

示例：

| Error type | Typical fix |
| --- | --- |
| Duplicate existing posting | 在 FinTrack 中取消真正的重复项，或修正日期、账户、分类。 |
| Unmatched transfer | 匹配转账，选择外部账户，或重新分类。 |
| Account not open | 选择已打开账户，或更新 Beancount account lifecycle。 |
| Ledger check failed | 重试前先修复会计问题。 |

除非你理解会计影响，否则不要为了绕过 failed handoff 而手动编辑 Beancount production files。

## 22. 端到端 Handoff Runbook 示例

这是一个完整的月度 operator runbook。

在 FinTrack 中：

1. 同步交易。
2. 复核该月份所有交易。
3. 解决转账匹配。
4. 打开 Beancount。
5. 选择目标月份。
6. 刷新 preflight。
7. 修复 blockers，直到 preflight 通过。
8. 点击 Write handoff。

在 Beancount worker 环境中：

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

回到 FinTrack：

1. 刷新状态。
2. 确认 worker 显示 `ready_for_approval`。
3. 复核 manifest 和 draft。
4. 点击 Approve。

再次运行 worker：

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

在 FinTrack 中确认：

```text
merged
```

在 Beancount repo 中：

```bash
git status --short
git diff -- main.bean book/
make ledger-check
git add main.bean book/
git commit -m "Import FinTrack YYYY-MM handoff"
```

如果使用 Fava：

```bash
make ledger-fava-artifact-timestamped
make ledger-fava-check LEDGER_ARTIFACT=dist/fava-ledger-<timestamp>
```

按你的 Fava 部署流程发布已检查 artifact。

## 23. Fava 边界

Fava 应视为只读展示层。

推荐 Fava 挂载：

```text
/ledger      read-only checked artifact
```

不要挂载：

```text
FinTrack data directory
FinTrack handoff directory
Beancount raw import directory
Beancount staging directory
Writable Beancount repo checkout
```

这样可以避免 Fava 看到 raw imports、handoff drafts、SQLite databases 和无关私有文件。

## 24. Handoff 故障排查

### Write handoff 按钮提示 handoff root is not configured

设置：

```text
FINTRACK_HANDOFF_ROOT=/handoff
```

并把可写的宿主机目录挂载到 `/handoff`。

### Worker status 不显示

运行 Beancount worker。FinTrack 只读取 status files，不会运行 worker。

### Approve 按钮不可用

Worker 尚未达到 `ready_for_approval`，或者 decision 已经存在。

### Worker 显示 handoff failed

阅读错误信息。在 FinTrack 或 Beancount 中修复根因，然后写入新的 handoff。

### Fava 没有显示新月份

`merged` 更新的是 worker 使用的 Beancount repo checkout。Fava 可能仍在读取旧 artifact。请从已提交的 Beancount ledger 构建并发布新的 Fava artifact。

## 25. 导入和导出

Import 页面可以预览并导入交易文件。

应用也提供导出功能：

- Transactions
- Accounts
- Net worth
- Backups
- Beancount drafts

请把导出文件视为敏感财务数据。

## 26. 备份

定期备份 SQLite 数据库。

推荐备份内容：

```text
data/fintrack.db
```

如果应用正在运行，SQLite 可能还有 WAL/SHM 文件。复制数据库前请停止容器，或使用 SQLite-aware backup 方法。

建议计划：

- 每日本地备份
- 每周离设备备份
- 每月恢复测试

## 27. 更新 Docker 部署

如果你从 GHCR 部署：

1. 推送新的 commit 到 GitHub。
2. 等待 Docker image workflow 发布。
3. 在 NAS 上拉取 latest image。
4. 重建容器。
5. 检查应用健康状态。

SQLite data directory 应保持挂载，并且更新期间不应被替换。

## 28. 故障排查

### 应用打开时没有密码

`FINTRACK_PASSWORD` 可能为空。请在 compose environment 中设置它并重建容器。

### Sync 没有导入交易

检查：

- SimpleFIN access URL
- 容器网络访问
- SimpleFIN account permissions
- Sync logs
- Lookback window 是否覆盖预期交易

### 分类看起来不正确

检查：

- 手动规则
- AI 分类结果
- Beancount account import
- 分类合并和重命名历史

### Beancount handoff 被禁用

检查：

- `FINTRACK_HANDOFF_ROOT`
- Handoff directory mount
- Directory permissions

### Beancount accounts 没有显示

检查：

- `BEANCOUNT_ROOT`
- Read-only Beancount mount
- 挂载目录是否包含 `main.bean`
- Container user 是否能读取 account files

### Docker 容器无法写入数据库

检查：

- 宿主机 data directory 是否存在
- 宿主机 data directory 是否可由 container user 写入
- Linux/NAS hosts 上 UID/GID `1001` 是否有写权限或等效 ACL 权限
- Volume 是否挂载到 `/app/data`
- `DB_PATH=/app/data/fintrack.db`

## 29. 运维检查清单

每日：

- Sync。
- 复核新交易。
- 检查 transfers。

每周：

- 复核 reports。
- 应用 rules。
- 备份数据库。

每月：

- 完成交易复核。
- 运行 Beancount preflight。
- 写入 handoff。
- 运行 Beancount worker。
- Approve 或 reject。
- 确认 worker result。
- 如果使用 Beancount/Fava 工作流，提交并发布 Beancount/Fava artifacts。

# FinTrack 用户手册

本手册说明当前 FinTrack V2 的日常使用方式。当前界面以中文为主，下面的页面名称与应用内导航保持一致。

FinTrack 是私有的 Beancount 导入、暂存、复核和交接工具。它不是银行、券商、税务工具、权威会计系统、投资业绩系统，也不是 Fava 替代品。把导入数据用于财务决策前，请始终人工复核。

## 1. 登录和隐私边界

在浏览器中打开应用：

```text
http://<your-server>:3000
```

如果设置了 `FINTRACK_PASSWORD`，浏览器会提示输入 Basic Auth 凭据。默认用户名是：

```text
fintrack
```

如果应用打开时没有密码提示，请先停止容器，并在网络环境中使用前设置 `FINTRACK_PASSWORD`。

不要把真实账号、真实交易、SimpleFIN access URL、Basic Auth URL、CSV、SQLite 数据库、ledger 或 handoff 文件写入 issue、commit、文档或聊天记录。示例请使用 `<simplefin-access-url>`、`<account-name>`、`<YYYY-MM>` 这类占位符。

## 2. 初始设置

打开 `设置`。

配置：

- SimpleFIN access URL，如果需要自动同步。
- 每日同步时间。
- 可选 Gemini API key，用于 AI Ledger 账户建议。
- 可选 Claude API key，作为备用分类器。
- 如果使用 Beancount 导出或交接，通过环境变量配置 Beancount 和 handoff 路径。

设置页会把已配置的密钥保存到本地 SQLite 数据库中。请保护并备份该数据库。

## 3. V2 主流程

FinTrack 应作为 Beancount 前置准备管线使用：

```text
来源数据
  -> 原始导入归档
  -> 暂存审核
  -> 来源账户映射
  -> 现金提升或投资审核
  -> Ledger 准备
  -> Beancount 预检
  -> 草稿下载或 handoff 交接
```

主要导航：

| 页面 | 用途 |
| --- | --- |
| `控制中心` | 导入状态、复核数量、导出阻塞项和准备度汇总。 |
| `导入` | SimpleFIN 和 CSV 的导入入口。 |
| `Ledger 准备` | 处理现金交易的 Ledger 账户缺口和审核标记。 |
| `转账审核` | 确认推断出的转账配对，并映射外部账户侧。 |
| `导出中心` | Beancount 预检、草稿下载、交接写入和 worker 审批状态。 |
| `账户映射` | 映射来源账户、FinTrack 账户和 Beancount 账户。 |
| `Ledger 账户规则` | 确定性规则和可选 AI Ledger 账户建议。 |

Reports、net worth、分类管理等旧页面可能仍作为兼容或诊断视图存在，但不是 V2 主流程。

## 4. 从 SimpleFIN 导入

需要自动导入账户和现金交易时，使用 SimpleFIN 同步。

FinTrack 会：

1. 从 SimpleFIN 获取账户和交易。
2. 把来源事实保存到本地数据库。
3. 根据同步路径创建暂存或标准现金记录。
4. 保留复核状态和 pending-to-posted reconciliation 信息。
5. 让新增或不完整记录进入待复核状态。

如果同步失败，检查：

- SimpleFIN access URL 是否有效。
- 容器是否能访问网络。
- Bridge session 是否过期。
- SimpleFIN 是否共享了预期账户。
- 容器日志和导入历史。

## 5. 导入 CSV

打开 `导入`，选择 CSV 文件，选择或创建 profile，并映射列。

对于普通银行或现金 CSV：

- 映射日期、金额、描述、账户等必需字段，以及可选 Ledger 账户提示。
- 预览文件。
- 暂存导入。
- 打开导入批次进入 `暂存导入审核`。
- 修复必需字段错误和来源账户映射。
- 只把有效的现金交易提升到 Ledger 准备流程。

提升不是直接写入。FinTrack 会检查必需字段、来源账户映射，并在请求或要求时运行 promotion-time Beancount validation。

## 6. Fidelity Brokerage CSV 导入

Fidelity Brokerage CSV 作为投资导入处理，不作为普通现金导入处理。

对于这类文件，FinTrack 会：

- 将原始行归档，便于审计和 replay。
- 创建导入批次审核数据。
- 在可用时提取来源账户、证券、持仓和投资活动。
- 要求先完成来源账户映射。
- 允许把证券映射到 Beancount commodity。
- 让已审核的投资活动参与 Beancount 导出预检。

Fidelity Brokerage 行不会进入现金提升流程。不要把买入、卖出、股息、再投资、持仓或券商现金移动提升为普通银行交易。正确流程是完成投资审核，然后在导入批次或 `导出中心` 运行 Beancount 导出预检。

## 7. 导入批次审核

从 `导入` 或 `控制中心` 打开导入批次。

常见区域：

- `来源账户映射`：把导入的机构账户或来源账户映射到 FinTrack 账户。
- `证券映射`：把导入 symbol 或 CUSIP 映射到 Beancount commodity。
- `投资持仓`：复核导入的持仓快照。
- `投资活动`：复核买入、卖出、股息、再投资、转账和费用。
- `Ledger 准备记录`：复核可以成为现金交易的暂存行。

批次页可能显示 validation blockers。提升或导出预检前应先修复。投资导入显示“投资记录不走现金提升”是预期行为。

## 8. 账户映射

账户映射有两层：

- 导入批次内的来源账户到 FinTrack 账户映射。
- `账户映射` 页面中的 FinTrack 账户到 Beancount 账户映射。

资产账户应映射到合适的 `Assets:...` Beancount 账户，负债账户应映射到 `Liabilities:...` 账户。FinTrack 会读取只读挂载的 Beancount checkout，并在账户已关闭或交易日期尚未 open 时提示。

账户映射不完整会阻止提升或 Beancount 导出。

## 9. Ledger 准备

打开 `Ledger 准备` 处理仍需复核的现金交易。

常见原因：

- 缺少 Ledger 账户。
- 使用了审核用 Ledger 账户标记。
- Pending 或状态未解决。
- AI 建议置信度低。
- 导入行仍有 validation errors。

优先手动选择 Ledger 账户。对重复描述创建确定性规则。AI 建议可以加快处理，但只是建议，导出前仍应确认。

## 10. 规则和 AI 建议

打开 `Ledger 账户规则`。

规则根据稳定文本模式给交易分配 Ledger 账户。适合工资、利息、订阅、水电账单和其他重复描述。

推荐流程：

1. 先手动给已知交易分配 Ledger 账户。
2. 只有类似描述会重复出现时才创建规则。
3. 应用规则。
4. 导出前复核结果。

AI 分类是可选功能。配置后，FinTrack 可以使用 Gemini 或 Claude 推荐 Ledger 账户。AI 输出不是权威结果，不能替代人工复核。

## 11. 转账审核

导出前打开 `转账审核`。

FinTrack 可以推断以下转账：

- 银行账户之间转账。
- 信用卡还款。
- 钱包转账。
- 投资转账。

请确认真实配对，并在其中一侧不在 FinTrack 内时映射外部账户。错误的转账匹配可能导致重复支出或余额错误。

## 12. Beancount 导出预检

打开 `导出中心`，选择月份并刷新预检。

预检可能报告：

- 缺少 Ledger 账户或仍使用审核账户。
- 未匹配转账。
- 可能重复的已有 posting。
- 账户在交易日期未 open。
- Balance assertion 问题。
- 投资活动阻塞项。
- 缺少来源账户或证券映射。
- 草稿无法安全渲染。

下载草稿或写入 handoff 前必须修复 blockers。正确修复通常在 FinTrack 中完成：映射账户、选择 Ledger 账户、解决转账、忽略真正重复项，或完成投资审核。

## 13. Promotion-Time Beancount Validation

现金交易从暂存导入审核提升前，可以先用 Beancount 检查。

导入批次页提供显式 `Beancount 导出预检` 操作。提升操作也遵守 required validation gate：

- `optional` 模式下，FinTrack 会在请求时或 validator 可用时运行 validation，并显示结果。
- `required` 模式下，必须通过 Beancount 预检和外部 validation，否则 promotion 会被阻止。
- `disabled` 模式下，跳过外部 validator，但必需字段和预检 blockers 仍然有效。

该 gate 用于防止严格模式下无效的暂存现金记录进入 Ledger 准备流程。

## 14. 外部 Beancount Validation 设置

相关环境变量：

```text
FINTRACK_BEANCOUNT_VALIDATOR=bean-check
FINTRACK_BEANCOUNT_VALIDATION=optional
```

Validation 模式：

| 模式 | 行为 |
| --- | --- |
| `optional` | 默认。能运行就运行；validator 缺失时记录结果但不阻止。 |
| `required` | Validator 必须存在、能运行且通过。缺失或失败都会阻止 promotion/export。 |
| `disabled` | 跳过外部 validator。FinTrack preflight 仍会运行。 |

生产环境如果要求未通过 Beancount validation 就不能提升或交接，应使用 `required`。

## 15. Beancount Handoff

FinTrack 可以为单独的 Beancount worker 写入 handoff package。

FinTrack 典型挂载：

```text
/app/data     read-write  FinTrack SQLite database
/beancount    read-only   Beancount checkout
/handoff      read-write  Shared handoff directory
```

FinTrack 写入：

```text
FINTRACK_HANDOFF_ROOT/YYYY-MM/fintrack/
  manifest.json
  YYYY-MM.bean
  YYYY-MM-transactions.bean
  YYYY-MM-balances.bean
```

Worker 后续可能写入 `status.json`。用户批准或拒绝时，FinTrack 写入 `decision.json`。

状态流：

```text
No handoff
  -> FinTrack writes manifest and drafts
  -> Beancount worker validates draft
  -> ready_for_approval
  -> FinTrack approve or reject
  -> Beancount worker applies decision
  -> merged, rejected, or failed
```

`merged` 表示 worker 已提升 handoff 且 validation 通过。它不一定表示已经创建 Git commit，也不一定表示已经发布 Fava artifact。

## 16. 运行和批准 Worker

Beancount worker 是单独进程。典型命令：

```bash
make fintrack-handoff-worker HANDOFF_ROOT=/handoff
```

对于新的 handoff，worker 会：

1. 读取 `manifest.json`。
2. 把已复核 draft 复制到 Beancount staging。
3. 运行 import review checks。
4. 写入 `status.json`。
5. 停在 `ready_for_approval`。

回到 `导出中心`，复核 manifest、draft、交易数量、投资活动数量、转账数量、warnings 和期间。只有 draft 正确时才批准。

批准后再次运行 worker。Worker 会读取 `decision.json`，重新运行检查，把 draft 提升到 Beancount，运行 validation，并写入最终状态。

## 17. `merged` 之后

生产环境 Beancount/Fava 流程通常仍需要 FinTrack 外部步骤：

```text
Review Beancount git diff
  -> run ledger check
  -> git commit
  -> build Fava artifact
  -> validate artifact
  -> publish artifact
  -> reload Fava
```

这些步骤属于 Beancount 部署流程，不属于 FinTrack。Fava 应只读取已检查 artifact，不应挂载 FinTrack data、raw imports、handoff drafts 或可写 Beancount checkout。

## 18. 故障排查

### 应用打开时没有密码

`FINTRACK_PASSWORD` 可能为空。设置后重建容器。

### CSV 导入有 validation errors

检查必需列映射、来源账户映射、日期格式、金额方向，以及该文件是否是应走投资审核而非现金提升的投资 CSV。

### Fidelity Brokerage 导入没有提升现金记录

这是预期行为。Brokerage 投资导入应完成来源账户、证券、持仓和投资活动审核，然后运行 Beancount 预检。

### Promote 按钮被阻止

检查缺失必需字段、未映射来源账户、已有 validation errors，以及 promotion-time Beancount validation。`required` 模式下 validator 必须已安装且通过。

### Beancount accounts 没有显示

检查 `BEANCOUNT_ROOT`、只读挂载、挂载目录是否包含 `main.bean`，以及 container user 是否能读取文件。

### Write handoff 不可用

检查 `FINTRACK_HANDOFF_ROOT`、handoff 挂载、目录权限和 Beancount preflight blockers。

### Worker status 不显示

运行 Beancount worker。FinTrack 只读取 status files，不会运行 worker。

### Fava 没有显示新月份

`merged` 更新的是 worker 使用的 Beancount checkout。请从已提交的 Beancount ledger 构建并发布已检查的 Fava artifact。

## 19. 备份清单

备份：

```text
data/fintrack.db
```

如果应用正在运行，SQLite 可能还有 WAL/SHM 文件。复制数据库前请停止容器，或使用 SQLite-aware backup 方法。

建议频率：

- 每日本地备份。
- 每周离设备备份。
- 每月恢复测试。

## 20. 运维检查清单

每日：

- 同步或导入新数据。
- 复核新的导入批次。
- 处理紧急 Ledger 准备项。

每周：

- 应用规则。
- 复核转账。
- 完成来源账户映射。
- 备份数据库。

每月：

- 完成现金交易复核。
- 完成投资活动和证券审核。
- 运行 Beancount 预检。
- 下载已检查草稿或写入 handoff。
- 运行 Beancount worker。
- 批准或拒绝。
- 确认最终 worker 状态。
- 如果使用 Beancount/Fava 工作流，提交并发布 Beancount/Fava artifacts。

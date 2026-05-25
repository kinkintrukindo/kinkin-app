# 用户指南 — Kin Kin Trukindo 管理系统

本指南面向日常管理此系统的管理员或负责人，无需技术背景。

---

## 入门

**在浏览器中打开：** [kinkintrukindo.com](https://kinkintrukindo.com)

本系统可在任何设备上使用——笔记本电脑、手机或平板电脑均可，因为所有数据存储在云端，无需安装任何软件。

**登录：** 输入授权码，然后点击 **Authorize**。

---

## 主界面

页面顶部有 **7 个标签页**（菜单）。点击标签页进行切换：

| 标签页 | 功能 |
|---|---|
| 📊 Dashboard | 整体业务概览 |
| 🚛 Trips | 所有卡车行程列表 |
| 💸 Expenses | 记录所有支出 |
| 🏦 Cash | 现金收支账本 |
| 👛 Petty Cash | 日常运营备用金（Martha） |
| 💰 Capital & Fleet | 车辆资产、贷款分期及资本 |
| 📄 Reports | 财务报告 |

---

## 标签页 1 — Dashboard（概览）

这是打开系统后显示的第一个页面，包含：

**KPI 卡片（顶部大数字）：**
- **Total Revenue** — 向客户开具发票的总金额
- **Trip Gross Profit** — 行程毛利润（收入减去司机费用）
- **Truck Ops Expenses** — 卡车运营支出（油费、过路费、配件等）
- **Overhead Expenses** — 办公/行政支出（行政费用、许可证等）
- **Net Profit** — 扣除所有支出后的净利润
- **Cash Balance** — 当前现金余额

点击任意卡片可查看详细明细。

**图表：** 显示每月收入和利润的趋势。

**导入 Excel：** 右上角黄色的 **📥 Import Excel Sheet** 按钮，每月用于导入 Martha 的报告。

**Import History（导入历史）：** 所有已导入文件的记录，可点击 🗑 Undo 按钮撤销错误的导入。

---

## 标签页 2 — Trips（行程）

所有卡车行程的完整列表。每行包含：
- 日期、发票号、目的地、车牌号、集装箱号
- **Sangu** = 司机津贴
- **Other Costs** = 其他额外费用
- **Total** = 司机总费用（津贴 + 其他费用）
- **Invoiced (Jual)** = 向客户开具的发票金额（收入）
- **Profit** = 发票金额减去司机总费用

### 手动添加行程

点击右上角的 **+ Add Trip**，填写表单，然后点击 **Add Trip**。

### 编辑行程

点击要修改行程所在行的 ✏️ 图标，直接在表格中编辑，点击 ✓ 保存或 ✕ 取消。

### 删除行程

点击要删除行所在行的 🗑 图标，删除前会出现确认提示。

---

## 标签页 3 — Expenses（支出）

此标签页记录公司所有支出，分为三种类型：

### 支出类型

**Truck / Operational（卡车运营）** — 与卡车直接相关的支出：
- 燃油（Fuel）、过路费（Toll）、维修（Repair）、配件（Spare Parts）、车库（Garage）等

**Overhead（管理费用）** — 办公室和业务支出：
- 工资（Salary）、办公室租金（Office Rent）、水电（Utilities）、行政（Admin）、保险（Insurance）、市场推广（Marketing）等

**Petty Cash（备用金）** — 向 Martha 补充运营备用金（见 Petty Cash 标签页）

### 添加支出

1. 选择类型：**Truck**、**Overhead** 或 **Petty Cash**
2. 填写日期、分类、说明和金额
3. **Truck** 类型：选择对应车牌
4. **Overhead** 类型：填写供应商名称（可选）
5. 点击 **+ Add Expense**

### 期间筛选

页面顶部有 **All Time / This Month / Last Month / Year to Date** 按钮用于筛选显示范围，也可自定义日期区间。

---

## 标签页 4 — Cash（现金）

简单的现金账本——记录公司账户或现金的所有收支流水。

**现金余额** = 总收入 − 总支出。

### 添加现金记录

1. 选择 **Cash In**（收入）或 **Cash Out**（支出）
2. 填写日期、说明和金额
3. 点击 **+ Add Entry**

> **说明：** 从 Petty Cash 或 Expenses 标签页向 Martha 充值备用金时，会自动在此处记录。在 Capital & Fleet 标签页记录卡车贷款分期付款时，也会自动在此处记录，无需手动填写。

---

## 标签页 5 — Petty Cash（备用金）

此标签页用于追踪 Martha 持有的**日常运营备用金**。

**运作方式：**
- 公司向 Martha 拨款（充值）
- Martha 用于日常运营支出
- 每月 Martha 通过 CSV/Excel 文件汇报支出情况
- Martha 余额 = 累计拨款总额 − 累计支出总额

### 查看 Martha 的明细

点击 **Martha** 卡片，可查看其名下所有充值记录和支出记录。

### 向 Martha 充值

在 **Record Top-Up** 区域，选择 Martha，填写日期和金额，然后点击 **+ Record Top-Up**。

> 此操作也会自动在 Cash 标签页记录为 **Cash Out**。

### 未分配支出（Unassigned）

如果有导入的支出尚未分配给 Martha，会出现 **Unassigned Expenses** 卡片。点击 **Assign to [姓名]** 进行分配。

---

## 标签页 6 — Capital & Fleet（资本与车队）

此标签页分为两个子标签：

### 子标签：Fleet & Loans（车队与贷款）

显示两辆卡车及其分期还款计划：
- **B9674UEJ** — 每月 Rp 10,877,000 × 36 期（自 2026 年 3 月起）
- **E9129YB** — 每月 Rp 12,028,000 × 36 期（自 2026 年 4 月起）

**记录分期还款：**
1. 在对应车辆卡片上，点击 **+ Record Payment**
2. 填写日期和金额
3. 点击 **Add Payment**

> 贷款剩余余额将自动减少，**付款金额也会自动记录为 Cash 标签页中的 Cash Out**，无需手动在 Cash 中录入。

**添加新车辆：** 点击右上角的 **+ Add Truck**。

### 子标签：Capital Injections（资本注入）

记录来自业主或外部融资的注资（不包括卡车分期付款）。

**添加方式：**
1. 选择类型：**Owner Capital**（自有资金）或 **Loan / Other Financing**（借款）
2. 填写表单，点击 **+ Record Capital / Loan**

---

## 标签页 7 — Reports（报告）

支持日期筛选的完整财务报告。

### 使用方法

1. 选择期间：**All Time / This Month / Last Month / Year to Date** 或自定义范围
2. 报告自动更新

### 导出到 Excel

点击 **📥 Download Excel Report**，下载 `.xlsx` 格式的报告文件。

---

## 导入 Martha 的月度报告（最重要！）

每月 Martha 会发送一份包含行程和支出列表的 Excel 或 CSV 文件。导入步骤：

1. 打开 **Dashboard** 标签页
2. 点击 **📥 Import Excel Sheet**
3. 从电脑中选择文件
4. 弹出窗口后，**选择与报告对应的月份**
5. 点击 **📋 Parse & Preview →**
6. 检查识别出的行程和支出列表——如有错误，所有字段均可编辑
7. 确认无误后，点击 **✓ Confirm Import**

**系统自动处理：**
- 重复数据（已存在的行程）将被自动跳过
- 如果 Martha 是唯一的备用金持有人，支出将自动分配给她
- 导入记录保存在 **Import History** 中，如有错误可随时撤销

---

## 撤销错误导入

1. 打开 **Dashboard** 标签页
2. 向下滚动至 **📜 Import History**
3. 找到需要撤销的导入记录
4. 点击 **🗑 Undo**
5. 输入管理员密码确认——该次导入的所有行程和支出记录将被删除

---

## 重置所有数据

> ⚠️ **警告：此操作将永久删除所有数据。**

在 Dashboard 页面最底部有一个 **Danger Zone** 区域，其中有 **Reset All Data** 按钮。仅在确实需要重新开始时使用，操作需要输入管理员密码。

---

## 常见问题

**关闭浏览器后数据还在吗？**
在的。每次有变更时，数据都会自动保存到云端（Supabase）。

**两个人可以同时使用吗？**
可以，但请避免同时编辑相同数据，否则可能产生冲突。

**手机上怎么打开？**
打开浏览器（Chrome 或 Safari），输入 `kinkintrukindo.com`，然后输入授权码。

**为什么现金余额和预期不符？**
请确认所有卡车贷款分期付款都已在 **Capital & Fleet** 标签页中记录——付款会自动计入 Cash Out。运营支出也需要正确记录，余额才会准确。

**Martha 有些支出还没记录怎么办？**
在 **Expenses** 标签页手动添加 → 选择 **Petty Cash** → 选择 Martha。

---

## 技术联系

如需功能变更、错误修复或技术支持，请联系开发人员，并提供以下访问权限：
- 代码库目录：`kinkin-app` 文件夹
- Supabase 项目：`ivybpomjhgfkrmfuxfsm`
- Vercel 项目：`kinkin-app`，团队 `info-95777617s-projects`

# AI Trading View

AI 产业链涨幅节奏看板。前端使用 React + ECharts，后端使用 Node.js 同源托管页面、共享看板数据，并代理请求 Yahoo Finance 行情。

## 功能

- 股票和标签管理
- 标签均值、个股、混合图表模式
- 可选日线、周线、月线
- Yahoo Finance 后端行情接口
- 共享股票池和标签体系
- SQLite 本地持久化协作数据
- 图表图片导出

## 环境要求

- Node.js `>=24`
- npm
- curl
- 能访问 Yahoo Finance 的网络环境

后端使用 Node 内置 `node:sqlite` 保存共享看板状态，数据库文件默认在 `data/app.sqlite`。后端请求 Yahoo 使用系统 `curl`，因为 Yahoo 对 Node 原生 `fetch` 更容易返回 `429`。

## 本地运行

```bash
npm install
npm run local
```

打开：

```text
http://localhost:4173/
```

`npm run local` 会先构建前端，再启动 Node 服务。

## 开发运行

一个终端启动后端：

```bash
npm run dev:server
```

另一个终端启动 Vite：

```bash
npm run dev
```

打开：

```text
http://localhost:5173/
```

Vite 会把 `/api` 代理到 `http://localhost:4173`。

## 协作方式

当前版本是「工作区代码协作」：

- 所有人访问同一个部署地址
- 每个人可以创建自己的工作区
- 创建工作区会生成两组代码：编辑代码、只读代码
- 其他人输入代码即可进入对应工作区
- 股票池、标签、视图 Tab、选中状态、周期配置按工作区保存到服务器 SQLite
- 浏览器本机会保存最近进入过的工作区代码，方便下次从「工作区」面板快速切回
- 页面右上角会显示同步状态
- `共享已同步`：编辑权限，数据已保存到服务器
- `只读工作区`：只读权限，不会保存修改
- `保存中`：正在写入服务器
- `本地模式`：未进入工作区，当前只保存在浏览器本地
- `共享离线`：工作区保存失败，会先保留在浏览器本地

代码权限：

| 代码类型 | 权限 |
|---|---|
| 编辑代码 | 可新增/删除股票、维护标签、保存看板配置、重置代码 |
| 只读代码 | 可查看图表和导出图片，不会保存修改 |

使用步骤：

1. 打开看板，点击标题栏的「工作区」。
2. 创建工作区，系统会生成编辑代码和只读代码。
3. 把编辑代码发给共同维护的人，把只读代码发给只看图的人。
4. 对方点击「工作区」，输入代码即可进入同一个工作区。

视图 Tab 是工作区数据的一部分。同一个工作区里的总览、上游、中游、下游或自定义视图会跟随工作区同步；不同工作区之间互不影响。

这一版没有账号登录，本质是“谁有代码谁能进”。适合小团队私有部署使用。不要直接暴露到公共互联网，建议放在内网、VPN、Cloudflare Access、Nginx Basic Auth 或其他访问控制后面。

## API

Node 服务会提供：

- `GET /api/health`：健康检查
- `POST /api/workspaces`：创建工作区
- `POST /api/workspaces/join`：输入代码加入工作区
- `GET /api/workspaces/:id/state`：读取工作区状态
- `PUT /api/workspaces/:id/state`：保存工作区状态
- `POST /api/workspaces/:id/reset`：清空工作区状态
- `POST /api/workspaces/:id/rotate-code`：重置编辑/只读代码
- `POST /api/prices/batch`：批量获取 Yahoo 行情

## 服务器部署

### 1. 拉代码

```bash
git clone https://github.com/derekchan10/ai-trading-view.git
cd ai-trading-view
```

### 2. 安装依赖并构建

```bash
npm install
npm run build
```

### 3. 启动服务

```bash
PORT=4173 npm start
```

打开：

```text
http://服务器IP:4173/
```

## PM2 部署

安装 PM2：

```bash
npm install -g pm2
```

启动：

```bash
PORT=4173 pm2 start server/index.mjs --name ai-trading-view --node-args="--disable-warning=ExperimentalWarning"
pm2 save
```

查看日志：

```bash
pm2 logs ai-trading-view
```

重启：

```bash
pm2 restart ai-trading-view
```

更新代码：

```bash
git pull
npm install
npm run build
pm2 restart ai-trading-view
```

## Nginx 反向代理

示例配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS 可以用 Certbot：

```bash
sudo certbot --nginx -d your-domain.com
```

## 数据存储和备份

默认数据文件：

```text
data/app.sqlite
```

这个文件包含所有工作区、工作区代码 hash、股票池、标签、选中状态和看板配置。它不会提交到 Git。

备份：

```bash
mkdir -p backups
cp data/app.sqlite backups/app-$(date +%F-%H%M%S).sqlite
```

恢复：

```bash
pm2 stop ai-trading-view
cp backups/app-你的备份.sqlite data/app.sqlite
pm2 start ai-trading-view
```

## 行情请求和代理

后端请求 Yahoo 不受浏览器 CORS 限制，但 Node 进程所在网络仍然需要能访问 Yahoo Finance。

如果本机或服务器需要代理，请使用能覆盖 Node/curl 进程的全局/TUN 代理。只开浏览器代理通常不够，因为行情请求发生在 Node 后端。

Yahoo 对批量请求比较敏感，后端默认：

```text
MARKET_REQUEST_CONCURRENCY=5
MARKET_REQUEST_GAP_MS=150
```

临时调低：

```bash
MARKET_REQUEST_CONCURRENCY=2 MARKET_REQUEST_GAP_MS=300 npm start
```

临时调高：

```bash
MARKET_REQUEST_CONCURRENCY=8 MARKET_REQUEST_GAP_MS=100 npm start
```

如果出现 `403` 或 `429`，优先换一个能访问 Yahoo 的代理节点或服务器出口。

## 常用命令

```bash
npm run build        # 构建前端
npm run local        # 构建并启动本地服务
npm run dev:server   # 只启动 Node 后端
npm run dev          # 启动 Vite 开发服务
npm start            # 启动生产服务
```

## GitHub 协作

GitHub 只用于存放代码，不跑 GitHub Pages。

建议协作流程：

```bash
git pull
git checkout -b feature/your-change
# 修改代码
npm run build
git add .
git commit -m "Describe your change"
git push origin feature/your-change
```

然后在 GitHub 发 Pull Request。

注意：`data/app.sqlite` 是服务器运行数据，不提交到 Git。多人协作看板数据通过部署后的同一个 Node 服务和工作区代码共享，而不是通过 Git 同步。

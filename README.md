# Weekly Review

个人每日/每周进度复盘看板。电脑和手机都能用，数据全部是你电脑上的 Markdown 文件。

- **零依赖**：只需要 Node.js 20+，不用 `npm install`。
- **数据本地化**：每周一个文件 `data/2026-W45.md`，任何 AI 或工具都能直接读写。格式见 [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)。
- **实时同步**：AI 改了文件，打开的网页会自动刷新；两个设备同时编辑也不会互相覆盖。

## 运行

```bash
node server.js
```

终端会打印两个地址：

- `http://localhost:4173`：在这台电脑上打开。
- `http://192.168.x.x:4173`：手机连**同一个 Wi-Fi** 时用这个。

可选环境变量：`PORT`（默认 4173）、`DATA_DIR`（数据目录，默认 `./data`）、`HOST`（默认 `0.0.0.0`；只想本机访问就设成 `127.0.0.1`）。

例如把数据放进一个同步文件夹：

```bash
DATA_DIR=~/Documents/weekly-review-data node server.js
```

## 在外面用手机访问

服务没有登录功能，**不要把端口直接暴露到公网**。推荐装 [Tailscale](https://tailscale.com)（免费），电脑和手机登录同一账号后，手机用电脑的 Tailscale 地址访问即可。

## 使用

- 点 **+ Add** 新增；**Enter** 在下面再加一条；内容为空时按 **Backspace** 删除这一条。
- 每次编辑后自动保存，右上角显示保存状态。
- 用顶部的 ‹ › 切换周；链接里带着周号（例如 `#2026-W45`），可以收藏。
- 手机上每屏只显示一个分类，左右滑动或点上方标签切换。

## 开发

```bash
npm test
```

| 路径 | 内容 |
|---|---|
| `server.js` | 本地服务：读写 Markdown、JSON API、文件监听、静态页面 |
| `shared/` | 周日期计算、数据模型、Markdown 解析与生成（服务端和浏览器共用） |
| `public/store.js` | 前端状态：自动保存、冲突合并、实时刷新（与 UI 无关） |
| `public/app.js`, `style.css` | 页面视图。**目前是占位样式，之后按设计稿替换** |

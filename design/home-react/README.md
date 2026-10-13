# 个人首页改版 · 独立 React 预览

**这是一个独立应用，不依赖也不修改 `frontend/` 里的任何文件。**
目的是让评审在真实浏览器里看间距与层级（静态截图判断距离不可靠）。

## 跑起来

```bash
cd design/home-react
./node_modules/.bin/vite --host 127.0.0.1 --port 5181 --strictPort
```

> ⚠️ 要用**仓库自带的 node**（`.tools/node-v24.21.0-darwin-arm64/bin/node`）跑。
> DSH 运行时的 node 与 `frontend/node_modules` 里 rollup 的原生模块签名不匹配，
> 会报 `ERR_DLOPEN_FAILED`；仓库自带的那份可以。

访问 <http://127.0.0.1:5181/>，地址栏加 `#light` / `#dark` 强制模式，右上角按钮也能切。

## 结构

| 文件 | 说明 |
|---|---|
| `index.html` | 外壳骨架（侧栏 / 顶栏由 `shell.js` 注入）+ 顶栏面包屑补丁 |
| `src/HomePage.tsx` | 个人首页，从 `../home-redesign/home-j1.html` 逐节点搬来 |
| `src/mockup.css` | 样张里的局部样式，原样搬过来，保证与样张一致 |
| `public/` | 从 `prototype/assets/` 复制的 tokens / base / shell 三套 CSS 与 shell.js、app.js |
| `node_modules` | 软链到 `../../frontend/node_modules`，复用依赖、不重新安装 |

## 与 5173 那个前端的关系

- **完全隔离**：本目录只服务自己，端口 5181，不动 `frontend/` 一个文件
- 数据目前是写死的演示值；要用真实数据得接 `getDashboardData()`（那一步在 `frontend/` 里做）

## 还没做的

- 窄屏适配（`.pagehead` 在 1100px 以下会堆叠，两个动作块掉到标题下面）
- 「今天已记录 / 今天还没记录」两种状态的切换
- 底部求助条在浅色下偏弱（之前记录过的问题）

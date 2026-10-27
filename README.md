# 文件阅览器

在浏览器里浏览服务器上的文件，或直接打开终端。

一个进程、一个端口。部署在哪台机器，就浏览哪台机器的文件、开那台机器的 shell。

---

## 快速开始

```bash
npm install
npm run build
npm start
```

启动后终端打印访问地址。登录密码在首次启动时生成，写入 `~/.ssh-lens-secret`（权限 0600）。

开发模式（前后端热更新）：

```bash
npm run dev
```

---

## 功能

**文件** —— 左侧目录树（懒加载 + 筛选 + 隐藏项开关），右侧预览：

| 类型 | 渲染方式 |
|---|---|
| Markdown | 衬线正文、表格、任务列表、代码高亮、**Mermaid 图** |
| HTML | sandbox iframe，同目录的 CSS/JS/图片自动内联，**可 50%–200% 缩放** |
| 图片 | 直接展示 |
| PDF | 浏览器内嵌查看器 |
| 代码 | highlight.js 语法高亮 |
| HTML / Markdown | 工具栏可切「渲染 / 源码」 |
| 二进制 / 超大文件 | 说明页 + 下载链接 |

GBK / GB2312 编码的文件会自动识别并正确解码。

**编辑** —— Markdown / HTML / 代码文件点「编辑」进入 CodeMirror 编辑器，带语法高亮和行号，保存前显示未保存标记。

**增删改** —— 顶部「＋ 文件」「＋ 目录」在根目录创建；每个条目悬停（或选中）时出现 `＋`（在目录内新建）、`✎`（重命名）、`✕`（删除）。删除目录会连同内容一起删除，弹窗二次确认。

**终端** —— xterm.js + node-pty，完整的交互式 shell。切到「文件」再切回来，会话不会丢。

---

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LENS_HOST` | `127.0.0.1` | 监听地址。设 `0.0.0.0` 让内网访问 |
| `LENS_PORT` | `7788` | 监听端口 |
| `LENS_ROOT` | 用户家目录 | 可浏览的根目录，路径被限制在此之内 |
| `LENS_PASSWORD` | 见下 | 登录密码；不设则读/生成 `~/.ssh-lens-secret` |
| `LENS_SESSION_KEY` | 随机 | 会话签名密钥；不设则重启后所有登录失效 |
| `LENS_SHELL` | `/bin/bash` | 终端使用的 shell |

---

## 安全

| 层 | 措施 |
|---|---|
| 登录 | 单密码，`timingSafeEqual` 比对，5 次/分钟锁定 |
| 会话 | HMAC 签名 httpOnly cookie，SameSite=Strict，7 天 |
| 路径 | 拒绝 `..` 与 NUL 字节，解析后必须落在 `LENS_ROOT` 内；写、删、重命名共用同一套校验 |
| 写入 | 只接受登录态请求；不能删除根目录；写入内容上限 2 MB |
| 终端 | WebSocket 握手校验 cookie，未登录直接 401 |
| HTML 预览 | sandbox iframe，含 `allow-scripts` 但**不含** `allow-same-origin`，页面脚本读不到会话 cookie |

> 绑 `0.0.0.0` 后同网段的任何人都会看到登录页，密码是唯一防线。首次启动生成的是 20 位随机串。

---

## 已知限制

- 终端会话只存在进程内存中，服务重启即丢失
- HTML 预览不处理内联 `<style>` 里的 `url()` 引用（外链 CSS 文件的相对路径图片不会自动内联）
- 单用户、单密码
- 删除不可撤销，没有回收站
- 文件树操作按钮依赖悬停；触摸设备上选中某行后才会出现

---

## 目录

```
server/
  config.ts    根目录、路径校验、密码
  auth.ts      密码、会话 cookie、限流
  files.ts     目录列表、文本读取、编码识别、HTML 资源内联
  shell.ts     PTY 与 WebSocket 协议
  index.ts     Express 装配 + WebSocket 升级
src/
  App.tsx           顶栏、文件/终端切换
  components/
    Login.tsx
    FileTree.tsx    懒加载目录树
    Preview.tsx     预览分派与渲染/源码切换
    TerminalPane.tsx
    Mermaid.tsx
```

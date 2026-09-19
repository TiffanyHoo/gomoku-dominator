# 称霸五子棋 🎮

双人联机五子棋对战游戏，基于 Node.js + SSE 实现。

## 功能特性

- 🎯 创建/加入房间对战
- 🌐 局域网联机
- 💬 实时聊天
- 🔄 一键重新开始

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务器

```bash
npm start
```

### 开始游戏

1. 启动后会显示访问地址：
   - 本机访问: `http://localhost:3000`
   - 局域网访问: `http://你的IP:3000`

2. 玩家1：打开网页，点击「创建房间」，获取房间号
3. 玩家2：打开网页，输入房间号，点击「加入房间」
4. 双方加入后即可开始对战！

## 技术栈

- **后端**: Node.js + SSE (Server-Sent Events)
- **前端**: 原生 HTML/CSS/JavaScript

## 项目结构

```
gomoku-online/
├── server.js        # 服务器入口
├── package.json     # 项目配置
└── public/
    ├── index.html   # 游戏页面
    ├── client.js    # 客户端逻辑
    └── style.css    # 样式文件
```

## License

MIT

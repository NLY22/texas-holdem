# ♠️ 德州扑克 P2P 实时对决系统 (Texas Hold'em P2P)

> 纯前端、零服务器后端成本、基于 WebRTC (PeerJS) 的多人实时德州扑克在线网页游戏。支持部署到 **GitHub Pages**，开箱即玩！

[![Deploy to GitHub Pages](https://github.com/NLY22/texas-holdem/actions/workflows/deploy.yml/badge.svg)](https://github.com/NLY22/texas-holdem/actions/workflows/deploy.yml)

## 🌟 核心特性

- **零后端 / 零维护成本**：基于 WebRTC DataChannel 协议，采用 PeerJS 免费云信令实现点对点直连。游戏所有数据（下注、发牌、筹码结算）完全在玩家浏览器端完成，无需自建或租用昂贵的云服务器。
- **高保真赌场绿绒桌 UI**：椭圆形实木皮质包边、经典绿色台布、精致纸牌阴影、动态筹码流转动效。
- **纯浏览器合成音效 (Web Audio API)**：发牌沙沙声、筹码清脆碰撞声、敲桌看牌声、胜利庆祝音，完全无需加载外部 MP3 音频文件，零延迟且零流量浪费。
- **全套标准德扑状态机**：
  - 完整轮次：盲注 (SB/BB) -> 翻牌前 (Preflop) -> 翻牌 (Flop) -> 转牌 (Turn) -> 河牌 (River) -> 摊牌 (Showdown)。
  - 精确边池计算 (Side Pots)：支持多位玩家筹码不等的 All-in 复杂拆分。
  - 7选5牌型评估：从高牌到皇家同花顺，带精准踢脚牌 (Kickers) 和平局分池裁决。
- **智能 AI 陪练模式**：内置启发式底池赔率与牌力评估算法，单人即可一键秒开，满桌电脑陪你练技术。
- **跨设备扫码即玩**：支持一键生成房间二维码，电脑当房主开房，手机扫一扫立即入座对战。

---

## 🚀 线上试玩

访问 GitHub Pages 线上公开地址：
👉 **`https://NLY22.github.io/texas-holdem/`**

---

## 🛠️ 本地运行与开发

```bash
# 1. 克隆仓库
git clone https://github.com/NLY22/texas-holdem.git
cd texas-holdem

# 2. 安装依赖
npm install

# 3. 启动本地开发服务器
npm run dev

# 4. 构建生产产物
npm run build
```

---

## 📜 许可证

MIT License

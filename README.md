# PiFlea Market — π 跳蚤市场

Pi Network 生态二手交易应用，基于 Pi SDK + Supabase，在 Pi Browser 中运行。

## 项目结构

```
piflea-market/
├── index.html              # 入口页面（骨架）
├── package.json            # 依赖配置
├── vite.config.js          # Vite 构建配置
├── .env                    # 环境变量（勿提交到 Git）
├── .env.example            # 环境变量模板
├── src/
│   ├── main.js             # 应用入口
│   ├── state.js            # 全局状态
│   ├── supabase.js         # Supabase 客户端
│   ├── pi-sdk.js           # Pi SDK 封装
│   ├── utils.js            # 工具函数
│   ├── router.js           # 视图路由
│   ├── components/
│   │   ├── card.js         # 商品卡片 HTML 生成
│   │   └── sheet.js        # 底部弹窗
│   ├── views/
│   │   ├── home.js         # 首页
│   │   ├── search.js       # 搜索页
│   │   ├── publish.js      # 发布商品
│   │   ├── detail.js       # 商品详情
│   │   ├── chats.js        # 消息列表 & 聊天
│   │   ├── mine.js         # 个人中心
│   │   └── admin.js        # 运营后台
│   └── styles/
│       ├── variables.css   # 主题变量
│       ├── base.css        # 基础样式 & 布局
│       ├── components.css  # 组件样式
│       └── views.css       # 页面样式
├── payment-test.html       # Pi 支付测试页（独立）
├── 404.html                # 404 页面
├── CNAME                   # 自定义域名 piflea.com
└── privacy.html / terms.html  # 隐私 & 条款
```

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器
npm run dev

# 3. 构建生产版本
npm run build
```

## 环境变量

复制 `.env.example` 为 `.env`，填入你的 Supabase 配置：

| 变量 | 说明 |
|------|------|
| `VITE_SUPABASE_URL` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase 匿名密钥 |
| `VITE_PI_SDK_VERSION` | Pi SDK 版本（2.0） |
| `VITE_PI_SANDBOX` | 是否沙箱模式（true/false） |
| `VITE_BACKEND_URL` | Pi 支付后端 Vercel 地址 |

## 部署

当前通过 GitHub Pages 部署，自定义域名 **piflea.com**。

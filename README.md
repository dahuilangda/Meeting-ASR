# Meeting ASR - 智能多用户会议语音转写系统

一个基于 FastAPI + React 的现代化多用户会议语音转写（ASR）系统，支持实时语音识别、智能标点、说话人分离、异步处理和队列管理等功能。

## 📋 目录

- [功能特性](#功能特性)
- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [详细安装指南](#详细安装指南)
- [数据库初始化](#数据库初始化)
- [管理员设置](#管理员设置)
- [使用指南](#使用指南)
- [API 文档](#api-文档)
- [部署指南](#部署指南)
- [故障排除](#故障排除)
- [项目结构](#项目结构)

## 🎯 功能特性

### 核心功能
- **高精度语音识别**：基于 FunASR 的中文语音识别，支持智能标点
- **说话人分离**：自动识别不同说话人，区分会议参与者
- **实时转写**：支持音频/视频文件的异步语音转写
- **智能队列管理**：多用户异步处理，确保系统稳定高效

### 多用户支持
- **用户隔离**：每个用户只能访问自己的作业和数据
- **并发限制**：默认每用户最多 2 个并发作业、系统最多 3 个作业同时处理，可通过环境变量灵活配置
- **实时队列状态**：查看作业在队列中的位置和预计等待时间
- **作业取消**：可取消尚未开始处理的作业

### 高级功能
- **实时状态更新**：WebSocket 实时推送作业状态和进度
- **进度追踪**：详细的作业处理进度显示
- **错误恢复**：完善的错误处理和重试机制
- **文件管理**：支持大文件上传（最大200MB）
- **批量处理**：支持多文件同时上传和排队

### 安全与管理
- **用户管理**：三级权限系统（普通用户/管理员/超级管理员）
- **JWT 认证**：安全的用户认证和授权
- **管理员面板**：用户管理、作业监控、系统配置
- **现代界面**：基于 Bootstrap 5 的响应式用户界面

## 💻 系统要求

### 最低要求
- **Python**: 3.8+
- **Node.js**: 16.0+
- **RAM**: 4GB（推荐 8GB+）
- **存储**: 至少 2GB 可用空间

### 推荐配置
- **Python**: 3.9+
- **Node.js**: 18.0+
- **RAM**: 8GB+
- **CPU**: 4核心以上
- **存储**: SSD，至少 5GB 可用空间

### 操作系统
- Linux（推荐 Ubuntu 20.04+）
- macOS 10.15+
- Windows 10+

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd Meeting-ASR
```

### 2. 后端设置

```bash
# 进入后端目录
cd backend

# 创建虚拟环境
python -m venv venv

# 激活虚拟环境
# Linux/macOS:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 3. 前端设置

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install
```

### 4. 启动服务

```bash
# 启动后端（在项目根目录）
./start_backend.sh

# 启动前端（在项目根目录）
./start_frontend.sh
```

### 5. 访问应用

- 前端地址：http://localhost:3030
- 后端地址：http://localhost:8000
- API 文档：http://localhost:8000/docs

### 6. 配置 OAuth 登录（可选）

如需启用 Google OAuth 注册/登录，请完成以下配置：

1. 在 Google Cloud Console 中创建 OAuth Client，并获取 **Web 应用** 的 `Client ID`。
2. 在后端 `.env` 文件中添加：

   ```env
   GOOGLE_CLIENT_ID=你的客户端ID
   # 如有多个客户端，可使用逗号分隔：GOOGLE_CLIENT_IDS=id1,id2
   ```

3. 在前端目录 `frontend/` 下创建或更新 `.env` 文件：

   ```env
   REACT_APP_GOOGLE_CLIENT_ID=你的客户端ID
   ```

未配置时，界面会自动隐藏 Google 登录按钮，普通账号注册登录不受影响。

## 📖 详细安装指南

### 后端详细安装

1. **环境准备**
```bash
# 安装 Python 3.8+
# Ubuntu/Debian:
sudo apt update
sudo apt install python3 python3-pip python3-venv

# CentOS/RHEL:
sudo yum install python3 python3-pip

# macOS (使用 Homebrew):
brew install python3
```

2. **虚拟环境创建**
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows
```

3. **依赖安装**
```bash
# 使用清华镜像加速
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 或使用默认源
pip install -r requirements.txt
```

### 前端详细安装

1. **Node.js 安装**
```bash
# 使用 nvm 推荐
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

2. **依赖安装**
```bash
cd frontend
npm install
# 或使用 yarn
yarn install
```

## 🗄️ 数据库初始化

### 首次安装（推荐）

```bash
cd backend
source venv/bin/activate

# 使用 SQLAlchemy 元数据初始化数据库
python -c "
from database.database import engine
from database import models
models.Base.metadata.create_all(bind=engine)
print('数据库初始化完成！')
"
```

> **说明**：默认使用 `sqlite.db`（位于 `backend/`）存储数据，`models.Base.metadata.create_all` 会自动创建所有需要的表。若将来数据库结构有改动，请再次执行上述脚本以确保新表生成。

### 手动创建超级管理员

```bash
cd backend
python create_super_admin.py
```

按照提示输入管理员信息：
- **用户名**：必填
- **邮箱**：可选
- **全名**：可选
- **密码**：至少6位字符

### 环境配置

创建 `backend/.env` 文件：

```env
# OpenAI 大语言模型配置
OPENAI_API_KEY="your-openai-api-key-here"
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_MODEL_NAME="gpt-4.1-mini"

# 或者使用自定义LLM服务（如本地部署）
# OPENAI_BASE_URL="http://your-llm-server:8000/v1"
# OPENAI_MODEL_NAME="your-model-name"

# JWT 认证配置
SECRET_KEY=your-super-secret-key-here-change-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Hugging Face 配置（用于语音识别模型）
HF_TOKEN="your-huggingface-token-here"
HF_ENDPOINT=https://hf-mirror.com

# 数据库配置
DATABASE_URL=sqlite:///./sqlite.db

# 生产环境配置
CORS_ORIGINS=http://localhost:3030,http://your-domain:3030
DEBUG=false
```

#### 🔑 获取 API 密钥

1. **OpenAI API 密钥**
   - 访问 [OpenAI API](https://platform.openai.com/api-keys)
   - 创建账户并获取 API 密钥
   - 将密钥填入 `OPENAI_API_KEY`

2. **Hugging Face Token**
   - 访问 [Hugging Face](https://huggingface.co/settings/tokens)
   - 创建账户并生成访问令牌
   - 将令牌填入 `HF_TOKEN`

3. **JWT 密钥**
   - 生成安全的随机字符串：
   ```bash
   openssl rand -hex 32
   ```
   - 将生成的字符串填入 `SECRET_KEY`

## 👤 管理员设置

### 用户权限级别

1. **普通用户 (user)**
   - 上传和处理音频/视频文件
   - 查看自己的作业
   - 编辑个人设置

2. **管理员 (admin)**
   - 管理普通用户账户
   - 查看所有用户作业
   - 系统监控

3. **超级管理员 (super_admin)**
   - 管理所有用户
   - 管理管理员权限
   - 系统配置

### 管理员面板功能

- **用户管理**：查看、编辑、禁用用户账户
- **作业监控**：查看所有用户的作业状态
- **系统统计**：用户数量、作业统计
- **权限管理**：调整用户角色和权限

## 📚 使用指南

### 用户注册和登录

1. **注册新账户**
   - 访问 http://localhost:3030
   - 点击注册按钮
   - 填写用户名、密码、邮箱（可选）
   - 提交注册

2. **登录系统**
   - 使用用户名和密码登录
   - 系统会自动跳转到仪表板

### 文件上传和处理

1. **支持的格式**
   - **音频**：MP3, WAV, FLAC, M4A, AAC
   - **视频**：MP4, AVI, MOV, MKV, M4V
   - **文件大小**：最大 200MB

2. **上传流程**
   - 在仪表板点击 "Upload New Audio/Video File"
   - 选择文件
   - 点击 "Upload and Process"
   - 文件将自动进入处理队列

3. **处理状态**
   - **Queued（排队）**：等待处理
   - **Processing（处理中）**：正在识别语音
   - **Completed（完成）**：处理完成，可查看结果
   - **Failed（失败）**：处理失败，查看错误信息

### 转写结果使用

1. **查看结果**
   - 在作业列表点击 "View Result"
   - 查看完整的转写文本
   - 查看说话人分离结果

2. **编辑功能**
   - **文本编辑**：直接编辑转写文本
   - **格式化**：自动添加标点和段落
   - **撤销/重做**：支持编辑历史记录
   - **说话人编辑**：修改说话人名称或合并说话人

3. **导出功能**
   - 支持 Markdown 格式导出
   - 保留说话人标记和时间戳

### 队列管理

1. **队列状态查看**
   - 实时显示活跃作业数量
   - 显示排队作业数量
   - 显示总队列大小

2. **作业控制**
   - 取消排队中的作业
   - 查看作业处理进度
   - 实时状态更新

## 🔧 API 文档

### 主要 API 端点

#### 用户管理
- `POST /register` - 用户注册
- `POST /token` - 用户登录
- `GET /users/me` - 获取当前用户信息
- `PUT /users/me` - 更新用户信息
- `POST /users/me/change-password` - 修改密码

#### 作业管理
- `POST /upload` - 上传文件
- `GET /jobs` - 获取用户作业列表
- `GET /jobs/{job_id}` - 获取作业详情
- `POST /jobs/{job_id}/cancel` - 取消作业
- `DELETE /jobs/{job_id}` - 删除作业

#### 队列管理
- `GET /queue/status` - 获取队列状态

#### WebSocket
- `WebSocket /ws/{token}` - 实时状态更新

### 在线文档
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🚀 部署指南

### 开发环境部署

```bash
# 克隆项目
git clone <your-repo-url>
cd Meeting-ASR

# 后端部署
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python create_super_admin.py
uvicorn main:app --host 0.0.0.0 --port 8000

# 前端部署（新终端）
cd frontend
npm install
npm run build
PORT=3030 npm start
```

### 生产环境部署

#### 使用 Docker（推荐）

1. **构建镜像**
```bash
# 构建后端镜像
docker build -t meeting-asr-backend ./backend

# 构建前端镜像
docker build -t meeting-asr-frontend ./frontend
```

2. **使用 Docker Compose**
```yaml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - SECRET_KEY=your-production-secret-key
    volumes:
      - ./data:/app/data

  frontend:
    build: ./frontend
    ports:
   - "3030:80"
    depends_on:
      - backend
```

#### 手动部署

1. **后端部署**
```bash
# 使用 Gunicorn
pip install gunicorn
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000

# 或使用 systemd
sudo tee /etc/systemd/system/meeting-asr.service > /dev/null <<EOF
[Unit]
Description=Meeting ASR Backend
After=network.target

[Service]
Type=exec
User=www-data
Group=www-data
WorkingDirectory=/path/to/Meeting-ASR/backend
Environment=PATH=/path/to/Meeting-ASR/backend/venv/bin
ExecStart=/path/to/Meeting-ASR/backend/venv/bin/gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable meeting-asr
sudo systemctl start meeting-asr
```

2. **前端部署**
```bash
cd frontend
npm run build

# 使用 nginx 或 Apache 静态文件服务
sudo cp -r build/* /var/www/html/
```

### 环境变量配置

生产环境 `backend/.env`：

```env
# 安全配置
SECRET_KEY=your-super-secure-secret-key-for-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# 可选配置
CORS_ORIGINS=https://yourdomain.com
DEBUG=false

# 队列并发控制（可选，默认为 3/50/2）
JOB_QUEUE_MAX_CONCURRENT=3     # 同时处理的最大作业数
JOB_QUEUE_MAX_SIZE=50          # 队列最大等待任务数
JOB_QUEUE_MAX_PER_USER=2       # 单个用户允许的并发任务数
```

> 提示：修改上述队列配置后需要重启后端服务，新的并发限制才会生效。

## 🔍 故障排除

### 常见问题

#### 1. 后端启动失败

**问题**：`ModuleNotFoundError: No module named 'sqlalchemy'`

**解决方案**：
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

**问题**：`sqlite3.OperationalError: no such table`

**解决方案**：
```bash
cd backend
python -c "
from database.database import engine
from database import models
models.Base.metadata.create_all(bind=engine)
print('数据库表创建完成')
"
```

#### 2. 前端编译错误

**问题**：`npm install failed`

**解决方案**：
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**问题**：`Failed to compile`

**解决方案**：
```bash
# 检查 Node.js 版本
node --version  # 应该 >= 16.0

# 清理缓存
npm cache clean --force
npm install
```

#### 3. 数据库问题

**问题**：枚举值错误 `LookupError: 'completed' is not among the defined enum values`

**解决方案**：
```bash
cd backend
python -c "
import sqlite3
conn = sqlite3.connect('sqlite.db')
cursor = conn.cursor()

# 更新枚举值
updates = {
    'processing': 'PROCESSING',
    'completed': 'COMPLETED',
    'failed': 'FAILED',
    'queued': 'QUEUED'
}

for old, new in updates.items():
    cursor.execute(f\"UPDATE jobs SET status = '{new}' WHERE status = '{old}'\")

conn.commit()
conn.close()
print('数据库枚举值更新完成')
"
```

#### 4. WebSocket 连接问题

**问题**：WebSocket 连接失败

**解决方案**：
- 检查防火墙设置
- 确保端口 8000 可访问
- 检查 JWT token 是否有效

#### 5. 文件上传问题

**问题**：文件上传失败

**解决方案**：
- 检查文件大小（最大 200MB）
- 检查文件格式是否支持
- 检查磁盘空间是否充足

### 日志查看

#### 后端日志
```bash
# 开发模式（会自动重载）
./start_backend.sh

# 查看详细日志
tail -f /var/log/meeting-asr.log
```

#### 前端日志
```bash
# 开发模式浏览器控制台
# 生产模式查看 nginx 错误日志
tail -f /var/log/nginx/error.log
```

### 性能优化

1. **数据库优化**
```sql
-- 添加索引
CREATE INDEX idx_jobs_owner_status ON jobs(owner_id, status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);
```

2. **文件处理优化**
- 定期清理临时文件
- 使用对象存储（如 AWS S3）
- 设置文件大小限制

3. **缓存优化**
- 使用 Redis 缓存频繁查询
- 配置 CDN 加速静态资源

## 📁 项目结构

```
Meeting-ASR/
├── backend/                 # 后端代码
│   ├── database/           # 数据库相关
│   │   ├── models.py       # 数据模型
│   │   ├── crud.py          # 数据库操作
│   │   ├── schemas.py      # API 模式
│   │   └── database.py     # 数据库连接
│   ├── main.py             # FastAPI 主应用
│   ├── job_queue.py        # 作业队列管理
│   ├── security.py         # 安全认证
│   ├── create_super_admin.py  # 管理员创建脚本
│   ├── requirements.txt    # Python 依赖
│   └── venv/              # 虚拟环境
├── frontend/              # 前端代码
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── pages/        # 页面组件
│   │   ├── api/          # API 调用
│   │   └── websocket.ts  # WebSocket 客户端
│   ├── public/            # 静态资源
│   ├── package.json       # Node.js 依赖
│   └── build/            # 构建输出
├── start_backend.sh       # 后端启动脚本
├── start_frontend.sh      # 前端启动脚本
├── .gitignore            # Git 忽略规则
└── README.md             # 项目文档
```

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 📞 支持

如果您遇到问题或有建议，请：

1. 查看本文档的故障排除部分
2. 搜索已有的 Issues
3. 创建新的 Issue 描述问题

## 📝 更新日志

### v2.0.0 (最新)
- ✨ 全新的多用户支持
- ✨ 异步作业队列系统
- ✨ 实时 WebSocket 通知
- ✨ 用户权限管理系统
- ✨ 管理员面板
- ✨ 现代化 UI 界面
- 🔧 性能优化和错误处理

### v1.0.0
- 🎯 基础语音转写功能
- 👥 说话人分离
- 📝 文本编辑功能
- 🎨 用户界面设计

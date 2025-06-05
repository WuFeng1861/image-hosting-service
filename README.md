# NestJS 图床后台系统

一个基于NestJS框架的图片上传和托管服务，支持多图片上传、图片访问和管理。

## 功能特点

- 支持多图片同时上传
- 大尺寸图片需要管理员验证
- 图片访问链接自动生成
- 支持中文文件名处理
- 图片强制缓存1年
- RESTful API设计

## 技术栈

- NestJS - Node.js服务端框架
- TypeORM - ORM工具
- MySQL - 数据库
- Multer - 文件上传处理

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置环境变量

创建`.env`文件并配置必要的环境变量:

```
# 应用配置
PORT=5888
NODE_ENV=development

# 图片服务域名配置（默认为127.0.0.1）
DOMAIN=127.0.0.1

# 管理员密码
SERVER_PASSWORD=wufeng1998-img

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=image_hosting

# 图片存储配置
UPLOAD_DIR=uploadImage
MAX_FILE_SIZE=2097152 # 2MB
```

### 创建数据库

```sql
CREATE DATABASE image_hosting CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 运行应用

开发模式：

```bash
npm run start:dev
```

生产模式：

```bash
npm run build
npm run start:prod
```

## API文档

详细的API文档请参考 [api.md](api.md) 文件。

## 项目结构

```
├── src/
│   ├── common/               # 公共模块
│   │   ├── dto/              # 数据传输对象
│   │   ├── filters/          # 异常过滤器
│   │   └── interceptors/     # 拦截器
│   ├── images/               # 图片模块
│   │   ├── dto/              # 图片相关DTO
│   │   ├── entities/         # 图片实体定义
│   │   ├── images.controller.ts  # 图片控制器
│   │   ├── images.module.ts  # 图片模块定义
│   │   └── images.service.ts # 图片服务
│   ├── app.controller.ts     # 应用控制器
│   ├── app.module.ts         # 应用模块
│   ├── app.service.ts        # 应用服务
│   └── main.ts               # 应用入口
├── test/                     # 测试文件
├── .env                      # 环境变量
├── .gitignore                # Git忽略文件
├── api.md                    # API文档
├── package.json              # 项目依赖
├── tsconfig.json             # TypeScript配置
└── README.md                 # 项目说明
```

## 部署

生产环境部署需要注意以下几点：

1. 确保设置了正确的生产环境变量
2. 禁用TypeORM的`synchronize`选项（通过将`NODE_ENV`设置为`production`）
3. 配置适当的数据库连接池
4. 考虑使用反向代理（如Nginx）进行HTTPS和负载均衡

## 注意事项

- 图片文件存储在`uploadImage`目录下（可通过环境变量配置）
- 上传的图片使用UUID命名以避免冲突
- 图片访问URL格式：`http://{APP_DOMAIN}/images/{filename}`
# 图床后台系统API文档

## 基本信息

- 基础路径: `/api`
- 内容类型: `application/json` 或 `multipart/form-data`（上传文件时）

## 接口列表

### 1. 上传图片

#### 请求

- 方法: `POST`
- 路径: `/images/upload`
- 内容类型: `multipart/form-data`

#### 请求参数

| 名称 | 类型 | 必填 | 描述 |
|------|------|------|------|
| files | File[] | 是 | 要上传的图片文件（支持多文件上传） |
| serverPassword | String | 否 | 当图片超过2MB时需要提供管理员密码 |

#### 响应

```json
{
  "success": true,
  "message": "上传成功",
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "filename": "example.jpg",
      "originalName": "原始文件名.jpg",
      "mimeType": "image/jpeg",
      "size": 1024000,
      "url": "http://127.0.0.1/images/550e8400-e29b-41d4-a716-446655440000.jpg",
      "fileHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "createdAt": "2023-09-01T12:00:00Z"
    }
  ]
}
```

注意：系统会对上传的图片进行唯一性校验。如果发现重复的图片，将直接返回已存在图片的链接，不会重复存储。

#### 错误响应

```json
{
  "success": false,
  "message": "文件过大且管理员密码不正确",
  "error": "UNAUTHORIZED",
  "statusCode": 401
}
```

### 2. 获取所有图片

#### 请求

- 方法: `GET`
- 路径: `/images`

#### 查询参数

| 名称 | 类型 | 必填 | 描述 |
|------|------|------|------|
| page | Number | 否 | 页码，默认为1 |
| limit | Number | 否 | 每页数量，默认为20 |

#### 响应

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "filename": "550e8400-e29b-41d4-a716-446655440000.jpg",
        "originalName": "原始文件名.jpg",
        "mimeType": "image/jpeg",
        "size": 1024000,
        "url": "http://127.0.0.1/images/550e8400-e29b-41d4-a716-446655440000.jpg",
        "createdAt": "2023-09-01T12:00:00Z"
      }
    ],
    "meta": {
      "totalItems": 100,
      "itemCount": 20,
      "itemsPerPage": 20,
      "totalPages": 5,
      "currentPage": 1
    }
  }
}
```

### 3. 获取单个图片信息

#### 请求

- 方法: `GET`
- 路径: `/images/:id`

#### 路径参数

| 名称 | 类型 | 描述 |
|------|------|------|
| id | String | 图片ID |

#### 响应

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "550e8400-e29b-41d4-a716-446655440000.jpg",
    "originalName": "原始文件名.jpg",
    "mimeType": "image/jpeg",
    "size": 1024000,
    "url": "http://127.0.0.1/images/550e8400-e29b-41d4-a716-446655440000.jpg",
    "createdAt": "2023-09-01T12:00:00Z"
  }
}
```

### 4. 通过URL访问图片

图片可以通过以下URL格式直接访问：

```
http://{DOMAIN}/images/{filename}
```

例如：
```
http://127.0.0.1/images/550e8400-e29b-41d4-a716-446655440000.jpg
```

注意：图片设置了1年的强制缓存时间。

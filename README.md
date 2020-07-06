# miniprogram-file-uploader

小程序大文件上传库。

小程序中的上传文件 [`wx.uploadFile`](https://developers.weixin.qq.com/miniprogram/dev/api/network/upload/wx.uploadFile.html) 接口有大小限制（10M），采用分块上传的方式进行解决。该上传库依赖 [`FileSystemManager.readFile`](https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.readFile.html) 接口进行文件的分块读取，基础库版本 `2.10.0` 及以上支持，可通过 `isSupport` 接口判断。

## 支持的特性

* [x] 分块读取，可限制占用内存大小
* [x] 分块并发上传
* [x] 支持暂停、恢复、取消、重传
* [x] 支持秒传，计算md5判断服务端是否已存在
* [x] 支持进度、预估剩余时间、平均速度、出错自动重试
* [x] 错误处理

## 安装

通过 `npm` 安装

```bash
npm i miniprogram-file-uploader
```

## 使用

创建一个 `uploader` 实例：

```js

if (Uploader.isSupport()) {
  const uploader = new Uploader({
    tempFilePath,
    totalSize: size,
    uploadUrl: UPLOAD_URL,
    mergeUrl: MERGE_URL,
  })

  uploader.upload()
}
```

实例化后可以选择监听一些事件：

```js
// 成功或失败都会触发
uploader.on('complete', (res) => {
  console.log('upload complete', res)
})

// 文件上传成功
uploader.on('success', (res) => {
  console.log('upload success', res)
})

// 文件上传失败
uploader.on('fail', (res) => {
  console.log('fail', res)
})

// 文件进度变化
uploader.on('progress', (res) => {
  this.setData({
    progress: res.progress,
    uploadedSize: parseInt(res.uploadedSize / 1024),
    averageSpeed: parseInt(res.averageSpeed / 1000),
    timeRemaining: res.timeRemaining
  })
})
```

## 服务端如何接收

由于小程序端采用分块上传，服务端也需要进行秒传验证、接收分块、分块合并等处理，可参考 `example/server/app.js` 的实现，共涉及到三个接口：

1. 秒传验证 (`verifyUrl: Get`)

当配置项 `testChunks` 为 `true` 时，小程序端会预先发送一个验证请求，利用 `spark-md5` 根据文件内容计算出唯一标识，服务端可根据该值判断是否已经上传，或者上传了部分分片，并返回给前端。小程序端依此可以实现续传或秒传的效果。需注意的是，计算文件的 `hash` 值也有一定的时间和内存损耗。

#### 请求参数

| 属性       | 类型   | 说明          |
| ---------- | ------ | ------------- |
| identifier | `String` | 文件的 md5 值 |
| fileName   | `String` | 文件名        |

#### 返回参数

| 属性           | 类型    | 说明                               |
| -------------- | ------- | ---------------------------------- |
| url            | `String`  | 已上传时返回线上文件路径             |
| needUpload     | `Boolean` | 是否需要上传                       |
| uploadedChunks | `Array<Number>`   | 未完全上传时，返回已上传的分块序号 |

2. 接收分块 (`uploadUrl: Post`)

小程序端采用 [`wx.request`](https://developers.weixin.qq.com/miniprogram/dev/api/network/request/wx.request.html) 接口发送文件的二进制数据，`content-type` 为 `application/octet-stream`，服务端接收后放入暂存区，收到合并请求后进行合并。

上传接口的 `query` 中包含如下分块信息：

* `identifier`：文件的唯一标识
* `index`：分块的序号，从 0 开始
* `chunkSize`： 分块大小，最后一块可能小于该值
* `fileName`：文件名，传入的文件名
* `totalChunks`：分块的总数量，依据 `chunkSize` 计算
* `totalSize`：文件总大小

3. 合并分块 (`mergeUrl: Get`)

分块全部发送后，小程序端发送合并请求，服务端按分片序号进行合并，返回最终的文件线上路径。

#### 请求参数

| 属性       | 类型   | 说明          |
| ---------- | ------ | ------------- |
| identifier | `String` | 文件的 md5 值 |
| fileName   | `String` | 文件名        |

#### 返回参数

| 属性 | 类型     | 说明         |
| ---- | -------- | ------------ |
| url  | `String` | 线上文件路径 |

对于每个请求，小程序端依据配置 `successStatus` 、 `failStatus` 和返回的 `statusCode` 判断成功或失败。

* `200`, `201`, `202`: 请求成功
* `404`, `415`, `500`, `501`: 请求失败，会终止文件上传
* 其他状态码: 出错了，但是会自动重试

## API 文档

### Uploader

#### 配置项

实例化的时候可以传入配置项：

```js
const uploader = new Uploader(option)
```
| 配置项             | 必填 | 类型    | 说明                                                                               |
| ------------------ | ---- | ------- | ---------------------------------------------------------------------------------- |
| tempFilePath       | 是   | String  | 小程序内的文件临时路径                                                             |
| totalSize          | 是   | Number  | 文件的总大小，单位 B                                                               |
| verifyUrl          | 否   | String  | 秒传验证接口                                                                       |
| uploadUrl          | 是   | String  | 接收分块接口                                                                       |
| mergeUrl           | 是   | String  | 合并分块接口                                                                       |
| maxConcurrency     | 否   | Number  | 并发上传数，默认 5，最大不超过 10                                                  |
| generateIdentifier | 否   | Function | 可覆盖默认的生成文件唯一标识的函数，需返回 identifier                                |
| chunkSize          | 否   | Number  | 分块大小，默认 5 * 1024 * 1204 B                                                   |
| maxMemory          | 否   | Number  | 加载文件最大占用的内存，默认 100 * 1024 * 1024 B，内存占用过大时可能导致小程序闪退 |
| query              | 否   | Object  | 上传分块时可添加自定义的参数                                                       |
| header             | 否   | Object  | 上传分块时可添加自定义的请求头                                                     |
| testChunks         | 否   | Boolean | 是否需要进行秒传验证，默认为 false                                                 |
| maxChunkRetries    | 否   | Number  | 请求失败时最大重试次数，默认为 0                                                   |
| chunkRetryInterval | 否   | Number  | 自动重试间隔，默认为 0                                                             |
| timeout            | 否   | Number  | 请求超时时间，默认 10000 ms                                                        |
| successStatus      | 否   | Array   | 认为响应式成功的响应码，默认 [200, 201, 202]                                       |
| failStatus         | 否   | Array   | 认为是出错的响应码，默认 [404, 415, 500, 501]                                      |
| verbose            | 否   | Boolean | 是否输出开始日志，默认 false                                                       |


#### 方法

* .on(event, callback) 监听事件
* .off(event, callback) 移除事件监听
* .upload() 开始上传
* .pause() 暂停上传
* .resume() 继续上传，与 `pause` 配对使用
* .cancel() 取消所有上传文件，与 `upload` 配对使用
* .isSupport() 当前小程序版本是否支持

#### 事件

通过 `on` 方法进行监听

* `success`，上传成功时触发，`e = {errCode: 0, url: 'xxx'}`
* `fail`，上传失败时触发，`e = {errCode: 0, errMsg: 'xxx'}`
* `complete`，上传成功或失败时触发，返回值同 `success` 或 `fail`
* `retry`，请求重传时触发，`e = {statusCode: 302, url: 'xxx'}`
* `progess`，上传进度变化时触发，返回内容如下：

| 属性          | 类型   | 说明                    |
| ------------- | ------ | ----------------------- |
| totalSize     | Number | 文件的总大小，单位 B    |
| progress      | Number | 上传进度，范围 [0, 100] |
| uploadedSize  | Number | 已上传大小，单位 B      |
| averageSpeed  | Number | 平均速度，单位 B/s      |
| timeRemaining | Number | 预估剩余时间，单位 ms   |

## 注意事项

1. 由于 `wx.requst` 没有 `progressUpdate` 事件，这里的 `progress` 事件在收到分块请求结果后触发；
2. 真机 `chooseVideo` 返回的临时文件，每次计算 md5 值不同，无法使用秒传功能；
3. 真机缺少 `console.timeEnd` 方法，部分开发日志会打印不出来；

## 开发

```js
# 安装依赖
npm install

# 启动 example 中的服务，监听文件改动
npm run dev

# 编译
npm run build
```

/* eslint-disable no-console */
import SparkMD5 from 'spark-md5'
import config from './config'
import EventEmitter from './eventEmitter'
import * as Util from './util'
import * as Type from './type'

const requestAsync = Util.promisify(wx.request)
const fileManager = wx.getFileSystemManager()
const readFileAsync = Util.promisify(fileManager.readFile)
const miniProgram = wx.getAccountInfoSync()
const appId = miniProgram.appId
const MB = 1024 * 1024

class Uploader {
  constructor(option = {}) {
    this.config = Object.assign(config, option)
    this.emitter = new EventEmitter()
    this.size = this.config.size
    this.chunkSize = this.config.chunkSize
    this.tempFilePath = this.config.tempFilePath
    this.totalChunks = Math.ceil(this.size / this.chunkSize)
    this.maxLoadChunks = Math.floor(this.config.maxMemory / this.chunkSize)

    this._event()
  }

  async upload() {
    this._reset()

    // step1: 计算 identifier
    if (this.config.testChunks) {
      this.identifier = await this.computeMD5()
    } else {
      this.identifier = this.generateIdentifier()
    }

    // step2: 获取已上传分片
    if (this.config.testChunks) {
      const {
        needUpload,
        uploadedChunks
      } = await this.verifyRequest()

      // 秒传逻辑
      // 找不到合成的文件
      if (!needUpload) {
        this.progress = 100
        this.timeRemaining = 0
        this.dispatchProgress()
        this.emit('complete')
        return
      // 分片齐全，但没有合并
      } else if (uploadedChunks.length === this.totalChunks) {
        this.progress = 100
        this.timeRemaining = 0
        this.dispatchProgress()
        this.emit('uploadDone')
      } else {
        this.chunksIndexNeedRead = this.chunksIndexNeedRead.filter(v => !uploadedChunks.includes(v))
        this.chunksIndexNeedSend = this.chunksIndexNeedSend.filter(v => !uploadedChunks.includes(v))
        this.uploadedChunks = uploadedChunks.sort()
      }
    }

    this.chunksNeedSend = this.chunksIndexNeedSend.length
    this.sizeNeedSend = this.chunksNeedSend * this.chunkSize
    if (this.chunksIndexNeedSend.includes(this.totalChunks - 1)) {
      this.sizeNeedSend -= (this.totalChunks * this.chunkSize - this.size)
    }

    // step3: 开始上传
    this.isUploading = true
    this._upload()
  }

  _event() {
    // step4: 发送合并请求
    this.on('uploadDone', async () => {
      this.isUploading = false
      await this.mergeRequest()
    })
  }

  _reset() {
    this.chunksIndexNeedRead = Array.from(Array(this.totalChunks).keys())
    this.chunksIndexNeedSend = Array.from(Array(this.totalChunks).keys())
    this.chunksNeedSend = this.totalChunks
    this.sizeNeedSend = this.size
    this.identifier = ''
    this.chunksSend = 0
    this.chunksQueue = []
    this.uploadTasks = {}
    this.pUploadList = []
    this.uploadedChunks = []
    this.isUploading = false
    this.progress = 0
    this.uploadedSize = 0
    this.averageSpeed = 0
    this.timeRemaining = Number.POSITIVE_INFINITY
    this.dispatchProgress()
  }

  _upload() {
    this.startUploadTime = Date.now()
    this._uploadedSize = 0

    if (this.chunksQueue.length) {
      const maxConcurrency = this.config.maxConcurrency
      for (let i = 0; i < maxConcurrency; i++) {
        this.uploadChunk()
      }
    } else {
      this.readFileChunk()
    }
  }

  updateUploadSize(currUploadSize) {
    this.uploadedSize += currUploadSize // 总体上传大小，暂停后累计
    this._uploadedSize += currUploadSize // 上传大小，暂停后清空
    const time = Date.now() - this.startUploadTime // 当前耗时
    const averageSpeed = this._uploadedSize / time // B/ms
    const sizeWaitSend = this.sizeNeedSend - this.uploadedSize // 剩余需要发送的大小
    this.timeRemaining = parseInt(sizeWaitSend / averageSpeed, 10) // 剩余时间
    this.averageSpeed = parseInt(averageSpeed, 10) * 1000 // 平均速度 B/s
    this.progress = parseInt(((this.uploadedSize * 100) / this.sizeNeedSend), 10)
    this.dispatchProgress()
  }

  dispatchProgress() {
    this.emit('progress', {
      size: this.size,
      progress: this.progress,
      uploadedSize: this.uploadedSize,
      averageSpeed: this.averageSpeed,
      timeRemaining: this.timeRemaining
    })
  }

  pause() {
    this.isUploading = false
    Object.keys(this.uploadTasks)
      .forEach(index => {
        this.chunksIndexNeedRead.push(index)
        this.uploadTasks[index].abort()
      })
    this.uploadTasks = {}
  }

  resume() {
    this.isUploading = true
    this._upload()
  }

  cancel() {
    this.pause()
    this._reset()
  }

  readFileChunk() {
    const {
      tempFilePath,
      chunkSize,
      maxLoadChunks,
      chunksQueue,
      chunksIndexNeedRead,
      size
    } = this
    const chunks = Math.min(chunksIndexNeedRead.length, maxLoadChunks - chunksQueue.length)
    // 异步读取
    for (let i = 0; i < chunks; i++) {
      const index = chunksIndexNeedRead.shift()
      const position = index * chunkSize
      const length = Math.min(size - position, chunkSize)
      readFileAsync({
        filePath: tempFilePath,
        position,
        length
      }).then(res => {
        const chunk = res.data
        this.chunksQueue.push({
          chunk,
          length,
          index
        })
        this.uploadChunk()
        return chunk
      }).catch((e) => {
        this.emit('error', e)
      })
    }
  }

  uploadChunk() {
    // 暂停中
    if (!this.isUploading) return
    // 没有更多数据了
    if (!this.chunksQueue.length) return
    // 达到最大并发度
    if (Object.keys(this.uploadTasks).length === this.config.maxConcurrency) return

    const {
      chunk,
      index,
      length
    } = this.chunksQueue.shift()

    // 跳过已发送的分块
    if (this.uploadedChunks.includes(index)) {
      this.uploadChunk()
      return
    }

    const {
      uploadUrl,
      query,
      header
    } = this.config
    const identifier = this.identifier
    const url = Util.addParams(uploadUrl, {
      identifier,
      index,
      ...query
    })
    const task = wx.request({
      url,
      data: chunk,
      header: {
        ...header,
        'content-type': 'application/octet-stream'
      },
      method: 'POST',
      success: () => {
        this.chunksSend++
        delete this.uploadTasks[index]
        this.updateUploadSize(length)

        // 尝试继续加载文件
        this.readFileChunk()
        // 尝试继续发送下一条
        this.uploadChunk()
        // 所有分片发送完毕
        if (this.chunksSend === this.chunksNeedSend) {
          this.emit('uploadDone')
        }
      },
      fail: (res) => {
        this.emit('error', res)
      }
    })
    this.uploadTasks[index] = task
  }

  emit(event, data) {
    this.emitter.emit(event, data)
  }

  on(event, listenr) {
    this.emitter.on(event, listenr)
  }

  off(event, listenr) {
    this.emitter.off(event, listenr)
  }

  generateIdentifier() {
    let identifier = ''
    const generator = this.config.generateIdentifier
    if (Type.isFunction(generator)) {
      identifier = generator()
    } else {
      const uuid = `${appId}-${Date.now()}-${Math.random()}`
      identifier = SparkMD5.hash(uuid)
    }
    return identifier
  }

  async computeMD5() {
    const {
      tempFilePath,
      size,
      chunkSize
    } = this

    // 文件比内存限制小时，保存分片
    const isltMaxMemory = size < this.config.maxMemory
    const sliceSize = isltMaxMemory ? chunkSize : 10 * MB
    const sliceNum = Math.ceil(size / sliceSize)
    const spark = new SparkMD5.ArrayBuffer()
    for (let i = 0; i < sliceNum; i++) {
      const position = i * sliceSize
      const length = Math.min(size - position, sliceSize)
      // eslint-disable-next-line no-await-in-loop
      const chunk = await readFileAsync({
        filePath: tempFilePath,
        position,
        length
      }).then(res => res.data)
      if (isltMaxMemory) {
        this.chunksQueue.push({
          chunk,
          length,
          index: i
        })
      }
      spark.append(chunk)
    }
    this.chunksIndexNeedRead = []
    const identifier = spark.end()
    spark.destroy()
    return identifier
  }

  async verifyRequest() {
    const {
      verifyUrl,
      fileName
    } = this.config
    const verifyResp = await requestAsync({
      url: verifyUrl,
      data: {
        identifier: this.identifier,
        fileName
      }
    })
    return verifyResp.data
  }

  async mergeRequest() {
    const {
      mergeUrl,
      fileName
    } = this.config
    await requestAsync({
      url: mergeUrl,
      data: {
        identifier: this.identifier,
        fileName
      }
    })
    this.emit('complete')
  }
}

export default Uploader

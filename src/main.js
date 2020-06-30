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
    this.chunksIndex = Array.from(Array(this.totalChunks).keys())
    this.identifier = ''

    this.chunksSend = 0
    this.maxLoadChunks = Math.floor(this.config.maxMemory / this.chunkSize)
    this.chunkQueue = []
    this.uploadQueue = []
    this.pUploadList = []
    this.uploadedChunks = []

    this.event()
  }

  event() {
    this.on('uploadDone', async () => {
      await this.mergeRequest()
    })
  }

  async upload() {
    if (this.config.testChunks) {
      this.identifier = await this.computeMD5()

      const {
        needUpload,
        uploadedChunks
      } = await this.verifyRequest()

      // 秒传逻辑
      if (!needUpload) {
        this.emit('complete')
        return
      } else {
        this.uploadedChunks = uploadedChunks.sort()
      }
    } else {
      this.identifier = this.generateIdentifier()
    }

    // 需要发送的分片序号
    this.chunksIndex = this.chunksIndex.filter(v => !this.uploadedChunks.includes(v))
    if (this.chunkQueue.length) {
      const maxConcurrency = this.config.maxConcurrency
      for (let i = 0; i < maxConcurrency; i++) {
        this.uploadChunk()
      }
    } else {
      this.readFileChunk()
    }
  }

  readFileChunk() {
    const {
      tempFilePath,
      chunkSize,
      maxLoadChunks,
      chunkQueue,
      chunksIndex,
      size
    } = this
    const chunks = Math.min(chunksIndex.length, maxLoadChunks - chunkQueue.length)
    // 异步读取
    for (let i = 0; i < chunks; i++) {
      const index = chunksIndex.shift()
      const position = index * chunkSize
      const length = Math.min(size - position, chunkSize)
      readFileAsync({
        filePath: tempFilePath,
        position,
        length
      }).then(res => {
        const chunk = res.data
        this.chunkQueue.push({
          chunk,
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
    // 没有更多数据了
    if (!this.chunkQueue.length) return
    // 达到最大并发度
    if (this.uploadQueue.length === this.config.maxConcurrency) return

    const {
      chunk,
      index
    } = this.chunkQueue.shift()

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
        const taskIndex = this.uploadQueue.indexOf(task)
        this.uploadQueue.splice(taskIndex, 1)
        // 尝试继续加载文件
        this.readFileChunk()
        // 尝试继续发送下一条
        this.uploadChunk()
        // 所有分片发送完毕

        const uploadedChunks = this.uploadedChunks
        if ((this.chunksSend + uploadedChunks.length) === this.totalChunks) {
          this.emit('uploadDone')
        }
      },
      fail: (res) => {
        this.emit('error', res)
      }
    })
    this.uploadQueue.push(task)
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
        this.chunkQueue.push({
          chunk,
          index: i
        })
      }
      spark.append(chunk)
    }

    this.chunksIndex = []
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
    // console.log('verifyResp', verifyResp)
    return verifyResp.data
  }

  async mergeRequest() {
    const {
      mergeUrl,
      fileName
    } = this.config
    const mergeResp = await requestAsync({
      url: mergeUrl,
      data: {
        identifier: this.identifier,
        fileName
      }
    })
    this.emit('complete')
    console.log('mergeResp', mergeResp)
    return mergeResp.data
  }
}

export default Uploader

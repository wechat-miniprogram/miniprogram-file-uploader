/* eslint-disable no-console */
import Logger from 'js-logger'
import SparkMD5 from 'spark-md5'
import config from './config'
import EventEmitter from './eventEmitter'
import * as Util from './util'
import * as Type from './type'

Logger.useDefaults({
  defaultLevel: Logger.DEBUG,
  formatter(messages) {
    const now = new Date()
    const time = `${now.getHours}:${now.getMinutes()}:${now.getSeconds()}}`
    messages.unshift(time)
    messages.unshift('[Uploader}]')
  }
})

const fileManager = wx.getFileSystemManager()
const readFileAsync = Util.promisify(fileManager.readFile)
const miniProgram = wx.getAccountInfoSync()
const appId = miniProgram.appId
const MB = 1024 * 1024

class Uploader {
  constructor(option = {}) {
    this.config = Object.assign(config, option)
    this.emitter = new EventEmitter()
    this.totalSize = this.config.totalSize
    this.chunkSize = this.config.chunkSize
    this.tempFilePath = this.config.tempFilePath
    this.totalChunks = Math.ceil(this.totalSize / this.chunkSize)
    this.maxLoadChunks = Math.floor(this.config.maxMemory / this.chunkSize)

    this._event()
  }

  async upload() {
    this._reset()

    // step1: 计算 identifier
    try {
      if (this.config.testChunks) {
        this.identifier = await this.computeMD5()
      } else {
        this.identifier = this.generateIdentifier()
      }
    } catch (error) {
      this.handleFail({
        errCode: 10002,
        errMsg: error.message
      })
      return
    }
    // step2: 获取已上传分片
    if (this.config.testChunks) {
      const [verifyErr, verifyResp] = await Util.awaitWrap(this.verifyRequest())
      if (verifyErr) {
        this.handleFail({
          errCode: 20001,
          errMsg: verifyErr.errMsg
        })
        return
      }
      const {
        needUpload,
        uploadedChunks
      } = verifyResp.data

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
        return
      } else {
        this.chunksIndexNeedRead = this.chunksIndexNeedRead.filter(v => !uploadedChunks.includes(v))
        this.chunksIndexNeedSend = this.chunksIndexNeedSend.filter(v => !uploadedChunks.includes(v))
        this.uploadedChunks = uploadedChunks.sort()
      }
    }

    this.chunksNeedSend = this.chunksIndexNeedSend.length
    this.sizeNeedSend = this.chunksNeedSend * this.chunkSize
    if (this.chunksIndexNeedSend.includes(this.totalChunks - 1)) {
      this.sizeNeedSend -= (this.totalChunks * this.chunkSize - this.totalSize)
    }

    // step3: 开始上传
    this.isUploading = true
    this._upload()
  }

  _requestAsync(args = {}, callback) {
    const {
      chunkRetryInterval,
      maxChunkRetries,
      successStatus,
      failStatus
    } = this.config

    let retries = maxChunkRetries
    return new Promise((resolve, reject) => {
      const doRequest = () => {
        const task = wx.request({
          ...args,
          success: (res) => {
            const statusCode = res.statusCode

            // 标示成功的返回码
            if (successStatus.includes(statusCode)) {
              resolve(res)
            // 标示失败的返回码
            } else if (failStatus.includes(statusCode)) {
              reject(res)
            }

            // 重试
            if (retries > 0) {
              setTimeout(() => {
                --retries
                doRequest()
              }, chunkRetryInterval)
            } else {
              reject(res)
            }
          },
          fail: (res) => {
            reject(res)
          }
        })

        if (Type.isFunction(callback)) {
          callback(task)
        }
      }

      doRequest()
    })
  }

  handleFail(e) {
    if (this.isFail) return

    this.isFail = true
    this.cancel()
    this.emit('fail', e)
    this.emit('complete')
  }

  _event() {
    // step4: 发送合并请求
    this.on('uploadDone', async () => {
      this.isUploading = false
      const [mergeErr] = await Util.awaitWrap(this.mergeRequest())
      if (mergeErr) {
        this.handleFail({
          errCode: 20003,
          errrMsg: mergeErr.errMsg
        })
        return
      }
      this.emit('success')
      this.emit('complete')
    })
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
      totalSize: this.totalSize,
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

  _reset() {
    this.chunksIndexNeedRead = Array.from(Array(this.totalChunks).keys())
    this.chunksIndexNeedSend = Array.from(Array(this.totalChunks).keys())
    this.chunksNeedSend = this.totalChunks
    this.sizeNeedSend = this.totalSize
    this.identifier = ''
    this.chunksSend = 0
    this.chunksQueue = []
    this.uploadTasks = {}
    this.pUploadList = []
    this.uploadedChunks = []
    this.isUploading = false
    this.isFail = false
    this.progress = 0
    this.uploadedSize = 0
    this.averageSpeed = 0
    this.timeRemaining = Number.POSITIVE_INFINITY
    this.dispatchProgress()
  }

  readFileChunk() {
    const {
      tempFilePath,
      chunkSize,
      maxLoadChunks,
      chunksQueue,
      chunksIndexNeedRead,
      totalSize
    } = this
    const chunks = Math.min(chunksIndexNeedRead.length, maxLoadChunks - chunksQueue.length)
    // 异步读取
    for (let i = 0; i < chunks; i++) {
      const index = chunksIndexNeedRead.shift()
      const position = index * chunkSize
      const length = Math.min(totalSize - position, chunkSize)
      if (this.isFail) break
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
        return null
      }).catch(e => {
        this.handleFail({
          errCode: 10001,
          errMsg: e.errMsg
        })
      })
    }
  }

  uploadChunk() {
    // 暂停中
    if (!this.isUploading || this.isFail) return
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
      chunkSize: length,
      fileName: this.config.fileName,
      totalChunks: this.totalChunks,
      totalSize: this.totalSize,
      ...query
    })
    this._requestAsync({
      url,
      data: chunk,
      header: {
        ...header,
        'content-type': 'application/octet-stream'
      },
      method: 'POST',
    }, (task) => {
      this.uploadTasks[index] = task
    }).then(() => {
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
      return null
    }).catch(res => {
      this.handleFail({
        errCode: 20002,
        errMsg: res.errMsg
      })
    })
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
    const verifyResp = await this._requestAsync({
      url: verifyUrl,
      data: {
        fileName,
        identifier: this.identifier
      }
    })
    return verifyResp
  }

  async mergeRequest() {
    const {
      mergeUrl,
      fileName
    } = this.config
    const mergeResp = await this._requestAsync({
      url: mergeUrl,
      data: {
        fileName,
        identifier: this.identifier
      }
    })
    return mergeResp
  }
}

export default Uploader

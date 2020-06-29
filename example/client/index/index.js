import {promisify } from './util'
const SparkMD5 = require('./spark-md5')
const app = getApp()
const fileManager = wx.getFileSystemManager()
const requestAsync = promisify(wx.request)
const readFileAsync = promisify(fileManager.readFile)

const HOST_IP = '192.168.100.24'
const MERGE_URL = `http://${HOST_IP}:3000/merge`
const VERIFY_URL = `http://${HOST_IP}:3000/verify`
const UPLOAD_URL = `http://${HOST_IP}:3000/upload`

const MB = 1024 * 1024
const uuid = 'wx407d0fba58912be6'

Page({
  data: {
    progress: 0,
    useFileHash: false
  },
  onLoad: function () {
    console.log('代码片段是一种迷你、可分享的小程序或小游戏项目，可用于分享小程序和小游戏的开发经验、展示组件和 API 的使用、复现开发问题和 Bug 等。可点击以下链接查看代码片段的详细文档：')
    console.log('https://mp.weixin.qq.com/debug/wxadoc/dev/devtools/devtools.html')

    this.chunkSize = 5 * MB
    this.resetState()
  },

  onUseHashChange(e) {
    const value = e.detail.value
    this.data.useFileHash = value
  },

  onChunkSizeChange(e) {
    const value = e.detail.value
    this.chunkSize = value * MB
  },

  async chooseVideo() {
    this.updateProgress(0)
    const {
      tempFilePath,
      size,
    } = await wx.chooseVideo({
      sourceType: ['album'],
      compressed: false
    })
    this.uploadFileInfo = {
      tempFilePath,
      size,
    }
    
    const readStart = Date.now()
    const chunkList = await this.readFileChunk()
    const readEnd = Date.now()
    console.log('File Chunk Num: ', chunkList.length, ' Use : ', readEnd - readStart)

    const hashStart = Date.now()
    const fileHash = this.computeFileHash(chunkList)
    const hashEnd = Date.now()
    console.log('Compute Hash Use: ', hashEnd - hashStart)

    this.updateProgress(10)
    this.uploadFileInfo.fileHash = fileHash
    await this.handleUpload(chunkList)
  },

  async handleUpload(chunkList = []) {
    const {
      tempFilePath,
      fileHash
    } = this.uploadFileInfo

    if (!tempFilePath || !fileHash) {
      wx.showToast({title: '选择视频后上传', icon: 'none'})
      return
    }
    const {
      needUpload,
      uploadedChunks
    } = await this.verifyUpload()
    if (needUpload) {
      await this.uploadChunks(chunkList, fileHash, uploadedChunks)
      await this.mergeRequest()
    }

    this.updateProgress(100)
    this.resetState()
  },

  resetState() {
    this.worker = null
    this.uploadTasks = []
    this.uploadFileInfo = {}
  },

  handlePause() {
    this.uploadTasks.forEach(task => task.abort())
    this.uploadTasks = []
  },

  async handleResume() {
    await this.handleUpload()
  },

  async verifyUpload() {
    const {
      fileHash
    } = this.uploadFileInfo
    const verifyResp = await requestAsync({
      url: VERIFY_URL,
      data: {
        fileHash
      }
    })
    console.log('verifyResp', verifyResp)
    return verifyResp.data
  },

  async mergeRequest() {
    const {
      fileHash
    } = this.uploadFileInfo

    const mergeResp = await requestAsync({
      url: MERGE_URL,
      data: {
        fileHash
      }
    })
    console.log('mergeResp', mergeResp)
    return mergeResp.data
  },

  async uploadChunks(chunkList = [], fileHash, uploadedChunks) {
    const that = this
    const pUploadList = []
    chunkList.forEach((chunk, index) => {
      if (uploadedChunks.includes(index)) return

      const pUpload = new Promise((resolve, reject) => {
        const task = wx.request({
          url: `${UPLOAD_URL}?fileHash=${fileHash}&index=${index}`,
          data: chunk,
          header: {
            'content-type': 'application/octet-stream'
          },
          method: 'POST',
          success: function(res) {
            const increment = parseInt((1 / chunkList.length) * 80)
            const progress = that.data.progress + increment
            that.updateProgress(progress)
            resolve(res)
          },
          fail: function(res) {
            reject(res)
          }
        })
        that.uploadTasks.push(task)
      })
      pUploadList.push(pUpload)
    })
    await Promise.all(pUploadList)
  },

  async readFileChunk() {
    const {
      tempFilePath,
      size
    } = this.uploadFileInfo
    const chunkSize = this.chunkSize

    const pChunkList = []
    const chunks = Math.ceil(size / chunkSize)
    for (let i = 0; i < chunks; i++) {
      const length = (i === chunks - 1) ? (size - i * chunkSize) : chunkSize
      const pFile = readFileAsync({
        filePath: tempFilePath,
        position: i * chunkSize,
        length
      }).then(res => {
        return res.data
      })
      pChunkList.push(pFile)
    }
    return Promise.all(pChunkList)
  },

  updateProgress(progress) {
    this.setData({progress})
  },

  computeFileHash(chunkList = []) {
    let hash = ''
    if (this.data.useFileHash) {
      const spark = new SparkMD5.ArrayBuffer()
      for(const chunk of chunkList) {
        spark.append(chunk)
      }
      hash = spark.end()
      spark.destroy()
    } else {
      hash = SparkMD5.hash(`${uuid}-${Date.now()}`)
    }
    return hash
  },
})

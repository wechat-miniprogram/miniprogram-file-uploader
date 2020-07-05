import Uploader from '../lib/uploader'
// import Uploader from 'miniprogram-uploader'

// 使用测试机的IP地址，在工具设置中忽略域名校验
const HOST_IP = '192.168.100.24'
const MERGE_URL = `http://${HOST_IP}:3000/merge`
const VERIFY_URL = `http://${HOST_IP}:3000/verify`
const UPLOAD_URL = `http://${HOST_IP}:3000/upload`

const MB = 1024 * 1024
Page({
  data: {
    progress: 0,
    uploadedSize: 0,
    averageSpeed: 0,
    timeRemaining: Number.POSITIVE_INFINITY,
    testChunks: false
  },

  onLoad() {
    this.chunkSize = 5 * MB
  },

  onTestChunksChange(e) {
    const value = e.detail.value
    this.data.testChunks = value
  },

  async chooseVideo() {
    this.reset()
    const {
      tempFilePath,
      size,
    } = await wx.chooseVideo({
      sourceType: ['album'],
      compressed: false
    })

    if (!Uploader.isSupport()) {
      wx.showToast({
        title: '分片上传在 2.10.0 版本以上支持',
        icon: 'none',
        duration: 3000
      })
      return
    }
    const uploader = new Uploader({
      tempFilePath,
      totalSize: size,
      fileName: 'demo',
      verifyUrl: VERIFY_URL,
      uploadUrl: UPLOAD_URL,
      mergeUrl: MERGE_URL,
      testChunks: this.data.testChunks,
      verbose: true
    })
    uploader.on('retry', (res) => {
      console.log('retry', res.url)
    })

    uploader.on('complete', (res) => {
      console.log('upload complete', res)
    })

    uploader.on('success', (res) => {
      console.log('upload success', res)
    })

    uploader.on('fail', (res) => {
      console.log('upload fail', res)
    })

    uploader.on('progress', (res) => {
      this.setData({
        progress: res.progress,
        uploadedSize: parseInt(res.uploadedSize / 1024),
        averageSpeed: parseInt(res.averageSpeed / 1024),
        timeRemaining: res.timeRemaining
      })
    })

    uploader.upload()

    this.uploader = uploader
  },

  reset() {
    this.setData({
      progress: 0,
      uploadedSize: 0,
      averageSpeed: 0,
      timeRemaining: Number.POSITIVE_INFINITY,
    })
  },

  handleUpload() {
    this.uploader && this.uploader.upload()
  },

  handlePause() {
    this.uploader && this.uploader.pause()
  },

  handleResume() {
    this.uploader && this.uploader.resume()
  },

  handleCancel() {
    this.uploader && this.uploader.cancel()
  }
})

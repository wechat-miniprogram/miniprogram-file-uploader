import Uploader from '../lib/uploader'

const HOST_IP = '10.9.171.33'
const MERGE_URL = `http://${HOST_IP}:3000/merge`
const VERIFY_URL = `http://${HOST_IP}:3000/verify`
const UPLOAD_URL = `http://${HOST_IP}:3000/upload`

const MB = 1024 * 1024

Page({
  data: {
    progress: 0,
    useFileHash: false
  },

  onLoad() {
    this.chunkSize = 5 * MB
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
    const uploader = new Uploader({
      tempFilePath,
      size,
      fileName: '视频文件',
      verifyUrl: VERIFY_URL,
      uploadUrl: UPLOAD_URL,
      mergeUrl: MERGE_URL,
      testChunks: true
    })

    uploader.on('complete', () => {
      console.log('upload complete')
    })
    uploader.upload()
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

  handlePause() {
    this.uploadTasks.forEach(task => task.abort())
    this.uploadTasks = []
  },

  async handleResume() {
    await this.handleUpload()
  },

  updateProgress(progress) {
    this.setData({progress})
  },
})

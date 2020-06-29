const express = require('express')
const fs = require('fs-extra')
const bodyParser = require('body-parser')
const path = require('path')
const app = express()
const FileType = require('file-type')
const glob = require('glob')


const UPLOAD_DIR = path.resolve(__dirname, 'uploads')
const TEMP_DIR = path.resolve(__dirname, 'tmp')


app.post('/upload', bodyParser.raw({limit: '10mb'}), function(req, res) {
  const chunk = req.body
  const {fileHash, index} = req.query
  const chunkDir = path.resolve(TEMP_DIR, fileHash)
  fs.ensureDirSync(chunkDir)
  fs.writeFileSync(`${chunkDir}/${fileHash}-${index}`, chunk)
  res.send(
    JSON.stringify({
      errCode: 0,
      tempFilePath: `${fileHash}-${index}`
    })
  )
})

const mergeFiles = (chunkFilePaths, writeStream) => {
  return new Promise(resolve => {
    const pipeStream = () => {
      if (!chunkFilePaths.length) {
        writeStream.end('done')
        resolve()
        return
      }
      const filePath = chunkFilePaths.shift()
      const readSteam = fs.createReadStream(filePath)
      readSteam.pipe(writeStream, {end: false})
      readSteam.on('end', function() {
        fs.removeSync(filePath)
        pipeStream()
      })
    }
    pipeStream()
  })
}
 

app.get('/merge', async function(req, res) {
  const {fileHash} = req.query
  const chunkDir = path.resolve(TEMP_DIR, fileHash)
  const chunkFiles = fs.readdirSync(chunkDir)
  chunkFiles.sort((a, b) => a.split('-')[1] - b.split('-')[1])
  const chunkFilePaths = chunkFiles.map(fileName => path.resolve(chunkDir, fileName))

  const targetFilePath = path.resolve(UPLOAD_DIR, `${fileHash}`)
  const writeStream = fs.createWriteStream(targetFilePath)
  await mergeFiles(chunkFilePaths, writeStream)
  const {ext, mime} = await FileType.fromFile(targetFilePath)
  fs.renameSync(targetFilePath, `${targetFilePath}.${ext}`)
  fs.removeSync(chunkDir)
  
  res.send(
    JSON.stringify({
      errCode: 0
    })
  )
})

app.get('/verify', function (req, res) {
  const {fileHash} = req.query
  const matchs = glob.sync(`${fileHash}.*`, {cwd: UPLOAD_DIR})
  if (matchs.length) {
    res.send(
      JSON.stringify({
        errCode: 0,
        needUpload: false
      })
    )
  } else {
    const chunkDir = path.resolve(TEMP_DIR, fileHash)
    fs.ensureDirSync(chunkDir)
    const chunkFiles = fs.readdirSync(chunkDir)
    res.send(
      JSON.stringify({
        errCode: 0,
        needUpload: true,
        uploadedChunks: chunkFiles.map(fileName => fileName.split('-')[1] * 1)
      })
    )
  }
})

 
const server = app.listen(3000, function () {
 
  const host = server.address().address
  const port = server.address().port
 
  console.log("应用实例，访问地址为 http://%s:%s", host, port)
 
})

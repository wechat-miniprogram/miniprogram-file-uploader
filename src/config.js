export default {
  tempFilePath: '',
  totalSize: 0,
  fileName: '',
  verifyUrl: '',
  uploadUrl: '',
  mergeUrl: '',
  maxConcurrency: 5,
  generateIdentifier: null,
  chunkSize: 5 * 1024 * 1024,
  maxMemory: 100 * 1024 * 1024,
  query: '',
  header: {},
  testChunks: true,
  chunkRetryInterval: 0,
  maxChunkRetries: 0,
  successStatus: [200, 201, 202],
  failStatus: [404, 415, 500, 501]
}

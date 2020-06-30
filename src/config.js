export default {
  tempFilePath: '',
  size: 0,
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
  chunkRetryInterval: null,
  maxChunkRetries: 0,
  successStatused: [200, 201, 202],
  permanentErrors: [404, 415, 500, 501]
}

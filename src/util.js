import * as Type from './type'

export function promisify(func) {
  if (!Type.isFunction(func)) return func
  return (args = {}) => new Promise((resolve, reject) => {
    func(
      Object.assign(args, {
        success: resolve,
        fail: reject
      })
    )
  })
}

export function addParams(url = '', params = {}) {
  const parts = url.split('?')
  const query = Object.keys(params).map(key => `${key}=${params[key]}`).join('&')
  return query ? `${parts[0]}?${query}` : parts[0]
}

export const awaitWrap = (promise) => promise
  .then(data => [null, data])
  .catch(err => [err, null])

export const compareVersion = (v1, v2) => {
  v1 = v1.split('.')
  v2 = v2.split('.')
  const len = Math.max(v1.length, v2.length)

  while (v1.length < len) {
    v1.push('0')
  }
  while (v2.length < len) {
    v2.push('0')
  }

  for (let i = 0; i < len; i++) {
    const num1 = parseInt(v1[i], 10)
    const num2 = parseInt(v2[i], 10)

    if (num1 > num2) {
      return 1
    } else if (num1 < num2) {
      return -1
    }
  }

  return 0
}
